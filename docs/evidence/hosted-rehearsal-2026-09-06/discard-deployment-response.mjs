// Opt-in, real Railway teaching fixture. Run from the repository root with
// node --import tsx PATH_TO_THIS_FILE --apply, a scoped staging token in
// RAILWAY_PROJECT_TOKEN, REHEARSAL_IMAGE, and REHEARSAL_SOURCE_SHA.
// This deliberately discards one accepted deployment response. It never retries
// that mutation or reconciles automatically. The ordinary CLI performs recovery.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
const { Railway } = await import(pathToFileURL(resolve('tools/railway.ts')).href);
const { execute } = await import(pathToFileURL(resolve('tools/operations.ts')).href);
const { LabError, loadRecord, targetSchema } = await import(pathToFileURL(resolve('tools/evidence.ts')).href);
if (process.argv.slice(2).join(' ') !== '--apply') throw new Error('This real staging fault rehearsal requires --apply.');
const config = z.object({staging: targetSchema, live: targetSchema}).strict().parse(JSON.parse(await readFile('config/lab.json', 'utf8')));
if (config.staging.environmentId === config.live.environmentId) throw new Error('Staging and live must be separate.');
const root = process.env.LAB_WORK_DIR ?? 'work/hosted-rehearsal';
const directory = join(root, 'faults', randomUUID());
await mkdir(directory, {recursive: true, mode: 0o700});
const request = {operation:'deploy',targetName:'staging',target:config.staging,apply:true,image:process.env.REHEARSAL_IMAGE,sourceSha:process.env.REHEARSAL_SOURCE_SHA,maxDurationSeconds:90};
let deploymentCalls = 0;
let dropped = false;
const transport = async (url, init) => {
  const body = JSON.parse(init.body);
  const isDeploy = body.query.includes('serviceInstanceDeployV2');
  if (isDeploy && ++deploymentCalls > 1) throw new Error('The fixture refuses a second deployment call.');
  const response = await fetch(url, init);
  if (isDeploy && response.ok) {
    const accepted = z.object({data:z.object({serviceInstanceDeployV2:z.string().uuid()}),errors:z.array(z.unknown()).optional()}).safeParse(await response.clone().json());
    if (accepted.success && !accepted.data.errors?.length) {
      await writeFile(join(directory,'discarded-response.json'), JSON.stringify({
        schemaVersion:1,at:new Date().toISOString(),teachingFixture:true,
        fault:'Discard an accepted Railway deployment response before the operator sees it',
        target:config.staging,acceptedDeploymentId:accepted.data.data.serviceInstanceDeployV2,
      },null,2)+'\n',{flag:'wx',mode:0o600});
      dropped = true;
      throw new Error('Intentional lost-response teaching fixture');
    }
  }
  return response;
};
const heartbeat=setInterval(()=>process.stderr.write('rehearsal: waiting for bounded provider checks...\n'),10000);
try {
  const original = await execute(request,new Railway(process.env.RAILWAY_PROJECT_TOKEN ?? '',config.staging,transport),root);
  const beforeBytes = await readFile(original.recordPath);
  if (!dropped || deploymentCalls !== 1 || original.outcome !== 'unknown_outcome' || original.reasonCodes.join(',') !== 'PROVIDER_TRANSPORT') throw new Error(`Fault was not exercised as expected. Inspect ${original.recordPath}; do not repeat the mutation.`);
  let blockedCode;
  try { await execute(request,new Railway(process.env.RAILWAY_PROJECT_TOKEN ?? '',config.staging),root); }
  catch(error) { if(error instanceof LabError && error.code==='OPERATION_LOCKED') blockedCode=error.code; else throw error; }
  if (!blockedCode) throw new Error('Expected the retained lock to block a repeated apply.');
  const originalRecord = await loadRecord(original.recordPath);
  if(originalRecord.deploymentId !== null)throw new Error('The operator must not know the discarded deployment ID.');
  const receipt = {schemaVersion:1,at:new Date().toISOString(),teachingFixture:true,sourceSha:process.env.REHEARSAL_SOURCE_SHA,image:process.env.REHEARSAL_IMAGE,directory,deploymentCalls,dropped,duplicateApply:blockedCode,original,originalChecksum:createHash('sha256').update(beforeBytes).digest('hex'),next:'Use the ordinary lab reconcile command with this original attempt UUID and the same work directory. Preserve this unknown record.'};
  await writeFile(join(directory,'result.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(receipt));
} finally {clearInterval(heartbeat);}
