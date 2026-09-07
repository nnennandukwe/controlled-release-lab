import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { fingerprint, imageSchema, LabError, type Target } from './evidence.js';

const deploymentSchema = z.object({
  id: z.string().uuid(), projectId: z.string(), serviceId: z.string(), environmentId: z.string(),
  status: z.string(), canRollback: z.boolean(), meta: z.record(z.string(), z.unknown()).nullable(),
});
const fields = 'id projectId serviceId environmentId status canRollback meta';
export type Deployment = { id: string; projectId: string; serviceId: string; environmentId: string; status: string; canRollback: boolean; image: string | null; metadataKeys: string[] };
export type Snapshot = { sourceImage: string | null; latestId: string | null; active: Deployment[]; configurationFingerprint: string };

function deploymentView(value: unknown): Deployment {
  const parsed = deploymentSchema.parse(value);
  // Compatibility contract: only an immutable image in this deployment's own
  // metadata qualifies. Service configuration alone is not serving-image proof.
  const image = imageSchema.safeParse(parsed.meta?.image);
  return { id: parsed.id, projectId: parsed.projectId, serviceId: parsed.serviceId, environmentId: parsed.environmentId, status: parsed.status, canRollback: parsed.canRollback, image: image.success ? image.data : null, metadataKeys: Object.keys(parsed.meta ?? {}).sort() };
}

export interface Hosting {
  assertScope(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  deployment(id: string): Promise<Deployment>;
  updateImage(image: string): Promise<void>;
  deploy(): Promise<string>;
  rollback(id: string): Promise<void>;
}

export class Railway {
  constructor(private token: string, private target: Target, private transport: typeof fetch = fetch) {
    if (!token.trim()) throw new LabError('MISSING_TOKEN', 'Set the environment-scoped RAILWAY_PROJECT_TOKEN in your secret store.');
  }
  private async call(query: string, variables: Record<string, unknown> = {}, mutation = false): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.transport('https://backboard.railway.com/graphql/v2', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { 'Content-Type': 'application/json', 'Project-Access-Token': this.token }, body: JSON.stringify({ query, variables }),
        });
      } catch {
        throw new LabError('PROVIDER_TRANSPORT', 'Railway request did not complete. Reconcile before repeating any mutation.', mutation ? 'unknown_outcome' : 'blocked');
      }
      if (!mutation && [429, 502, 503, 504].includes(response.status) && attempt < 2) {
        const seconds = Number(response.headers.get('retry-after') ?? '1');
        if (!Number.isFinite(seconds) || seconds > 5) throw new LabError('PROVIDER_RATE_LIMIT', 'Railway requested a longer retry delay. Retry this read later.');
        await delay(Math.max(1, seconds) * 1000); continue;
      }
      if (!response.ok) throw new LabError('PROVIDER_HTTP', `Railway returned HTTP ${response.status}. Check service access and provider status.`, mutation ? 'unknown_outcome' : 'blocked');
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new LabError('PROVIDER_RESPONSE', 'Railway returned an unreadable response. Reconcile any mutation.', mutation ? 'unknown_outcome' : 'blocked'); }
      const envelope = z.object({ data: z.unknown().optional(), errors: z.array(z.unknown()).optional() }).parse(payload);
      if (envelope.errors?.length || !envelope.data) throw new LabError('PROVIDER_REJECTED', 'PROVIDER_REJECTED: Railway rejected the request. Check token scope and the current API contract.', mutation ? 'unknown_outcome' : 'blocked');
      return envelope.data;
    }
  }
  async assertScope() {
    const result = z.object({ projectToken: z.object({ projectId: z.string(), environmentId: z.string() }) }).parse(await this.call('query { projectToken { projectId environmentId } }'));
    if (result.projectToken.projectId !== this.target.projectId || result.projectToken.environmentId !== this.target.environmentId) throw new LabError('TOKEN_SCOPE_MISMATCH', 'TOKEN_SCOPE_MISMATCH: Use the project token for this exact target environment.');
  }
  async snapshot(): Promise<Snapshot> {
    const result = z.object({
      serviceInstance: z.object({
        source: z.object({ image: z.string().nullable(), repo: z.string().nullable() }).nullable(),
        latestDeployment: z.object({ id: z.string().uuid() }).nullable(), activeDeployments: z.array(deploymentSchema),
        healthcheckPath: z.string().nullable(), startCommand: z.string().nullable(), numReplicas: z.number(), region: z.string().nullable(),
      }), variables: z.record(z.string(), z.string()),
    }).parse(await this.call(`query($serviceId:String!,$environmentId:String!,$projectId:String!) {
      serviceInstance(serviceId:$serviceId,environmentId:$environmentId) {
        source { image repo } latestDeployment { id } activeDeployments { ${fields} }
        healthcheckPath startCommand numReplicas region
      }
      variables(projectId:$projectId,serviceId:$serviceId,environmentId:$environmentId)
    }`, { serviceId: this.target.serviceId, environmentId: this.target.environmentId, projectId: this.target.projectId }));
    if (result.serviceInstance.source?.repo) throw new LabError('SOURCE_REBUILD_ENABLED', 'Disconnect the GitHub source before deploying verified prebuilt images.');
    const { healthcheckPath, startCommand, numReplicas, region } = result.serviceInstance;
    if (healthcheckPath !== '/readyz' || numReplicas !== 1 || (startCommand && startCommand !== 'node dist/src/main.js')) throw new LabError('HOST_CONFIGURATION', 'Set healthcheck /readyz, one replica, and the image default start command before operating this lab.');
    return {
      sourceImage: result.serviceInstance.source?.image ?? null,
      latestId: result.serviceInstance.latestDeployment?.id ?? null,
      active: result.serviceInstance.activeDeployments.map(deploymentView),
      configurationFingerprint: fingerprint({ healthcheckPath, startCommand, numReplicas, region, variables: Object.fromEntries(['LAB_ENVIRONMENT', 'PORT', 'NODE_ENV'].map(key => [key, result.variables[key] ?? null])) }),
    };
  }
  async deployment(id: string): Promise<Deployment> {
    const result = z.object({ deployment: deploymentSchema }).parse(await this.call(`query($id:String!) { deployment(id:$id) { ${fields} } }`, { id }));
    const deployment = deploymentView(result.deployment);
    if (deployment.projectId !== this.target.projectId || deployment.environmentId !== this.target.environmentId || deployment.serviceId !== this.target.serviceId) throw new LabError('DEPLOYMENT_TARGET_MISMATCH', 'Choose a deployment from this exact project, service, and environment.');
    return deployment;
  }
  async updateImage(image: string) {
    imageSchema.parse(image);
    const response = z.object({ serviceInstanceUpdate: z.boolean() }).parse(await this.call('mutation($serviceId:String!,$environmentId:String!,$input:ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId:$serviceId,environmentId:$environmentId,input:$input) }', { serviceId: this.target.serviceId, environmentId: this.target.environmentId, input: { source: { image } } }, true));
    if (!response.serviceInstanceUpdate) throw new LabError('IMAGE_UPDATE_UNCONFIRMED', 'Reconcile the image-source update before continuing.', 'unknown_outcome');
  }
  async deploy() {
    return z.object({ serviceInstanceDeployV2: z.string().uuid() }).parse(await this.call('mutation($serviceId:String!,$environmentId:String!) { serviceInstanceDeployV2(serviceId:$serviceId,environmentId:$environmentId) }', { serviceId: this.target.serviceId, environmentId: this.target.environmentId }, true)).serviceInstanceDeployV2;
  }
  async rollback(id: string) {
    // Live schema returns Boolean, despite the docs' object-shaped example.
    // Acknowledgment supplies no deployment identity; the operator reconciles.
    const result = z.object({ deploymentRollback: z.boolean() }).parse(await this.call('mutation($id:String!) { deploymentRollback(id:$id) }', { id }, true));
    if (!result.deploymentRollback) throw new LabError('ROLLBACK_UNCONFIRMED', 'Railway did not acknowledge rollback. Reconcile before attempting another mutation.', 'unknown_outcome');
  }
}
