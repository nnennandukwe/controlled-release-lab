import * as fs from 'node:fs/promises';
import { rehearseExposureRecovery } from '../tools/exposure-rehearsal.js';
import { createExposureDiagnostic, inspectExposureDiagnostic } from '../tools/exposure-diagnostic.js';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { featureFixture } from './helpers/feature-fixture.js';
import { policy, policyDigest, requestValidity } from '../tools/promotion.js';
import { exposurePolicyDigest, rosterDigest } from '../tools/exposure-observe.js';
import { exposureRequestSchema, serializeExposure, executeExposure, loadExposureRecord, createExposureEnvelope, verifyExposureRelease } from '../tools/exposure.js';
import { desiredFlagState, flagSnapshot, LaunchDarkly } from '../tools/launchdarkly.js';
import { readLockOwner, acquireLock, releaseReconciledLock, LabError } from '../tools/evidence.js';
import { sha256 } from '../tools/setup-verifier.js';
import type { Hosting, Snapshot } from '../tools/railway.js';
import captured from './fixtures/launchdarkly-off.json' with { type:'json' };

vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>() }));
vi.mock('jose',async original=>({...await original<typeof import('jose')>(),createRemoteJWKSet:()=>async()=>keys.publicKey}));
vi.mock('../tools/attestation.js',()=>({repository:'nnennandukwe/controlled-release-lab',issuer:'https://token.actions.githubusercontent.com',verifyArtifact:async(input:{workflow:string})=>({runId:input.workflow==='image.yml'?'10':'15',runAttempt:'1',statements:[]})}));
// Only advance the timer seam. Real sample parsing, HTTP responses, JWT signature,
// request/proof validation, provider adapter and immutable filesystem journals run.
vi.mock('node:timers/promises',()=>({setTimeout:async(milliseconds:number)=>{await vi.advanceTimersByTimeAsync(milliseconds);}}));
const keys=await generateKeyPair('RS256');
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(options:{rehearsal?:boolean;forged?:boolean;lost?:boolean;conflict?:boolean;unhealthy?:boolean;operation?:'expose'|'disable';stage?:'5'|'25'|'100';regressedMembership?:boolean;priorOperation?:'expose'|'observe-exposure';reconciled?:boolean}={}){
 vi.useFakeTimers({toFake:['Date','performance','setTimeout','clearTimeout']});
 const root=await mkdtemp(join(tmpdir(),'exposure-gate-'));roots.push(root);
 const subject={sourceSha:'b'.repeat(40),deploymentId:randomUUID(),targetName:'staging' as const,target:policy.targets.staging,image:`ghcr.io/${policy.repository}@sha256:${'a'.repeat(64)}`,configurationFingerprint:policy.configurationFingerprints.staging};
 const baseline=featureFixture(subject,'off');
 const raw=structuredClone(captured);
 const fromStage=options.operation==='disable'?'internal':options.stage==='100'?'25':options.stage==='25'?'5':options.stage==='5'?'internal':'off';
 const fromProof=featureFixture(subject,fromStage);
 Object.assign(raw.environments.test,fromProof.before.state,{version:fromProof.before.version});
 const {flagSnapshot}=await import('../tools/launchdarkly.js');const before=flagSnapshot(raw,'staging');
 const build={sourceSha:subject.sourceSha,runId:'10',runAttempt:'1'},operator={sourceSha:'c'.repeat(40),runId:'20',runAttempt:'1'};
 const record={schemaVersion:1,attemptId:randomUUID(),operation:'observe',targetName:'staging',target:subject.target,requestedImage:subject.image,requestedSourceSha:subject.sourceSha,rollbackTarget:null,deploymentId:subject.deploymentId,configurationFingerprint:subject.configurationFingerprint,startedAt:new Date(Date.now()-130000).toISOString(),finishedAt:new Date(Date.now()-1000).toISOString(),outcome:'verified',reasonCodes:[],recoveryInstruction:'',observations:[]};
 const envelope={schemaVersion:3,kind:'deployment-observation',record,context:{operator:{...operator,runId:'15'},build,policyDigest,requestDigest:'d'.repeat(64),purpose:'release',authorization:'protected-observation',audience:'synthetic-catalog-baseline',notEvaluated:['Customer impact']},featureProof:baseline};
 const files:Record<string,string>={'image.bundle.jsonl':'authenticated image seam','deployment-evidence.json':JSON.stringify(envelope),'deployment.bundle.jsonl':'authenticated deployment seam'};
 
 const operation=options.operation??'expose',stage=operation==='disable'?'off':options.stage??'internal';
 const request=exposureRequestSchema.parse({schemaVersion:1,kind:'exposure-request',purpose:options.rehearsal?'response-loss-rehearsal':'release',operation,stage,...subject,build,operator,policyDigest,exposurePolicyDigest,rosterDigest,before,desired:desiredFlagState(before,stage),changeReference:'BUILD-3-TEST',...requestValidity(),observation:{internal:120,population:1160,maxRequests:1200,deadlineSeconds:180},attachments:Object.entries(files).map(([name,bytes])=>({name,sha256:sha256(bytes)}))});
 if(options.stage){
  const priorOperation=options.priorOperation??'expose';
  const internalProof=featureFixture(subject,fromStage);
  const priorRequest=exposureRequestSchema.parse({...request,operation:priorOperation,stage:fromStage,operator:{...operator,runId:'15'},before:priorOperation==='expose'?featureFixture(subject,fromStage==='25'?'5':fromStage==='5'?'internal':'off').before:before,desired:internalProof.after.state});
  const priorRecord={schemaVersion:1 as const,kind:'exposure-record' as const,attemptId:randomUUID(),operation:options.reconciled?'reconcile-exposure' as const:priorOperation,request:priorRequest,requestDigest:sha256(serializeExposure(priorRequest)),startedAt:new Date(Date.now()-61000).toISOString(),finishedAt:new Date(Date.now()-1000).toISOString(),outcome:'verified' as const,reasonCodes:[],recoveryInstruction:'',submitted:priorOperation==='expose',acknowledged:priorOperation==='expose',featureProof:internalProof,authorization:priorOperation==='expose'?{fixture:'authenticated earlier run'}:null,reconciles:options.reconciled?randomUUID():null};
  files['prior-exposure.json']=JSON.stringify(createExposureEnvelope(priorRecord,{...operator,runId:'15'}));files['prior.bundle.jsonl']='authenticated earlier exposure seam';
  request.attachments=Object.entries(files).map(([name,bytes])=>({name:name as typeof request.attachments[number]['name'],sha256:sha256(bytes)}));
 }
 for(const[name,bytes]of Object.entries(files))await writeFile(join(root,name),bytes);
 const bytes=serializeExposure(request),requestDigest=sha256(bytes);await writeFile(join(root,'exposure-request.json'),bytes);
 const signIdentity=(digest:string)=>new SignJWT({repository_id:policy.repositoryId,repository_owner_id:policy.ownerId,repository:policy.repository,sub:`${policy.subjectPrefix}:environment:staging`,environment:'staging',ref:'refs/heads/main',event_name:'workflow_dispatch',runner_environment:'github-hosted',workflow_ref:`${policy.repository}/.github/workflows/operate.yml@refs/heads/main`,workflow_sha:operator.sourceSha,run_id:request.operator.runId,run_attempt:'1',check_run_id:'30',actor_id:policy.ownerId}).setProtectedHeader({alg:'RS256'}).setIssuer('https://token.actions.githubusercontent.com').setAudience(`https://github.com/${policy.repository}/release/${digest}`).setIssuedAt().setNotBefore('0s').setExpirationTime('5m').sign(keys.privateKey);
 let jwt=await signIdentity(requestDigest);
 for(const[key,value]of Object.entries({ACTIONS_ID_TOKEN_REQUEST_URL:'https://test.actions.githubusercontent.com/oidc',ACTIONS_ID_TOKEN_REQUEST_TOKEN:randomUUID(),GITHUB_REPOSITORY:policy.repository,GITHUB_REF:'refs/heads/main',GH_TOKEN:'test-only'}))vi.stubEnv(key,value);
 let patches=0;
 const transport=vi.fn<typeof fetch>(async(input,init)=>{
  const url=String(input);
  if(url.includes('test.actions.githubusercontent.com'))return Response.json({value:options.forged?'unsigned':jwt});
  if(url.includes('app.launchdarkly.com')){
   if(url.endsWith('/caller-identity'))return Response.json({accountId:'lab-account',serviceToken:true});
   if(url.includes('/projects?'))return Response.json({items:[{key:'default'}],totalCount:1});
   if(url.includes('/flags/default?'))return Response.json({items:[{key:'catalog-ranked-search'}],totalCount:1});
   if(init?.method==='PATCH'){
    patches++;expect((init.headers as Record<string,string>).Authorization).toBe('writer-fixture');
    const patch=JSON.parse(String(init.body));expect(patch).toContainEqual({op:'test',path:'/environments/test/version',value:raw.environments.test.version});
    if(options.conflict)return Response.json({code:'optimistic_locking_error'},{status:409});
    for(const part of patch) if(part.op==='replace') { if(part.path.endsWith('/rules')) raw.environments.test.rules=part.value.map((rule:object,index:number)=>({...rule,_id:(rule as {_id?:string})._id??`rule-${index}`})); if(part.path.endsWith('/on')) raw.environments.test.on=part.value; }
    raw.environments.test.version++;
    if(options.lost)throw new Error('Response lost after actual state change');
   }
   return Response.json(raw);
  }
  if(url.startsWith(subject.target.url)){
   const current=featureFixture(subject,flagSnapshot(raw,'staging').stage);
   const query=new URL(url);const sample=(current.measurement as {samples:{contextKey:string;query:string;results:string[];evaluation?:{cohort:string}}[]}).samples.find(s=>(query.searchParams.has('context')?s.contextKey===query.searchParams.get('context'):s.evaluation?.cohort==='excluded')&&s.query===query.searchParams.get('q'))!;
   if(options.regressedMembership&&query.searchParams.get('context')==='eligible-0001'&&raw.environments.test.on){
    const original=(featureFixture(subject,'off').measurement as {samples:typeof sample[]}).samples.find(s=>s.contextKey===sample.contextKey&&s.query===sample.query)!;
    return Response.json({...sample,requestId:randomUUID(),ranking:'original',evaluation:{...sample.evaluation,value:false,variationIndex:0},results:original.results.map(id=>({id}))});
   }
   return Response.json({...sample,requestId:randomUUID(),results:options.unhealthy&&raw.environments.test.on?[{id:'wrong-result'}]:sample.results.map(id=>({id}))});
  }
  if(url.includes('/compare/'))return Response.json({merge_base_commit:{sha:url.includes(subject.sourceSha)?subject.sourceSha:operator.sourceSha}});
  if(url.includes('deployment-branch-policies'))return Response.json({total_count:1,branch_policies:[{name:'main',type:'branch'}]});
  if(url.includes('/environments/'))return Response.json({can_admins_bypass:false,protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:Number(policy.ownerId)}}]}],deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}});
  if(url.endsWith('/branches/main'))return Response.json({protected:true});
  if(url.includes('/jobs?'))return Response.json({total_count:1,jobs:[{name:'operate',status:'in_progress',conclusion:null,check_run_url:`https://api.github.com/repos/${policy.repository}/check-runs/30`}]});
  const isBuild=url.includes('/runs/10/'),isCurrent=url.includes(`/runs/${request.operator.runId}/`);
  return Response.json({head_sha:isBuild?subject.sourceSha:operator.sourceSha,head_branch:'main',path:`.github/workflows/${isBuild?'image':'operate'}.yml`,event:'workflow_dispatch',run_attempt:1,status:isCurrent?'in_progress':'completed',conclusion:isCurrent?null:'success',actor:{id:Number(policy.ownerId)}});
 });
 vi.stubGlobal('fetch',transport);
 const hosting:Hosting={assertScope:vi.fn(async()=>{}),snapshot:vi.fn(async()=>baseline.providerBefore as Snapshot),deployment:vi.fn(async()=> (baseline.providerBefore as Snapshot).active[0]!),updateImage:vi.fn(),deploy:vi.fn(),rollback:vi.fn()};
 const flags=new LaunchDarkly('reader-fixture','writer-fixture','staging',transport);
 const input={operation,rehearseResponseLoss:options.rehearsal??false,targetName:'staging' as const,releaseDir:root,...(operation==='expose'?{stage:options.stage??'internal' as const}:{}),apply:true};
 const authorizeDisable=async()=>{
  request.operation='disable';request.stage='off';request.before=flagSnapshot(raw,'staging');request.desired=desiredFlagState(request.before,'off');
  request.operator={...operator,runId:'21'};Object.assign(request,requestValidity());
  const next=serializeExposure(request);await writeFile(join(root,'exposure-request.json'),next);jwt=await signIdentity(sha256(next));
  return{operation:'disable' as const,targetName:'staging' as const,releaseDir:root,apply:true};
 };
 return{root,request,bytes,hosting,flags,transport,input,raw,authorizeDisable,patches:()=>patches};
}
it('refuses a forged protected identity before submitting any flag effect',async()=>{
 const scenario=await fixture({forged:true});await expect(executeExposure(scenario.input,scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport)).rejects.toMatchObject({code:'AUTHORIZATION_REJECTED'});expect(scenario.patches()).toBe(0);
});
it('refuses stale versions and edited request subjects before PATCH',async()=>{
 const scenario=await fixture();scenario.raw.environments.test.version++;
 await expect(executeExposure(scenario.input,scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport)).rejects.toMatchObject({code:'FLAG_STATE_CHANGED'});expect(scenario.patches()).toBe(0);
});
it('releases a definite conditional conflict without claiming an uncertain accepted change',async()=>{
 const scenario=await fixture({conflict:true});const result=await executeExposure(scenario.input,scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport);
 expect(result).toMatchObject({outcome:'blocked',reasonCodes:['FLAG_CONFLICT']});expect(scenario.patches()).toBe(1);expect(await readLockOwner(join(scenario.root, 'work'), scenario.request.target)).toEqual(undefined);
});
it('retains a lost PATCH and shared lock, then reconciles real samples without repeating the effect',async()=>{
 const scenario=await fixture({lost:true}),work=join(scenario.root,'work');
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);expect(original.outcome).toBe('unknown_outcome');expect(scenario.patches()).toBe(1);
 const bytes=await readFile(original.recordPath);expect(await readLockOwner(work, scenario.request.target)).toEqual(expect.any(String));
 await expect(acquireLock(work,scenario.request.target,randomUUID())).rejects.toMatchObject({code:'OPERATION_LOCKED'});
 const current=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(current.outcome).toBe('verified');expect(scenario.patches()).toBe(1);expect(await readFile(original.recordPath)).toEqual(bytes);expect(await readLockOwner(work, scenario.request.target)).toEqual(undefined);
 const record=await loadExposureRecord(current.recordPath);expect(record.featureProof?.measurement).toMatchObject({requests:120,failures:0});expect(createExposureEnvelope(record,scenario.request.operator).record.reconciles).toBe(original.attemptId);
},30000);
it('holds an unhealthy but known exposure without blocking a separately authorized disable',async()=>{
 const scenario=await fixture({unhealthy:true});const result=await executeExposure(scenario.input,scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport);
 expect(result.outcome).toBe('blocked');expect(await readLockOwner(join(scenario.root, 'work'), scenario.request.target)).toEqual(undefined);
 const record=await loadExposureRecord(result.recordPath);expect(record.featureProof?.measurement).toMatchObject({failures:120});expect(()=>createExposureEnvelope(record,scenario.request.operator)).toThrow();
 const failedBytes=await readFile(result.recordPath);
 const disabled=await executeExposure(await scenario.authorizeDisable(),scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport);
 expect(disabled.outcome).toBe('verified');expect(scenario.patches()).toBe(2);expect(await readFile(result.recordPath)).toEqual(failedBytes);
 expect((await loadExposureRecord(disabled.recordPath)).featureProof?.measurement).toMatchObject({requests:1160,failures:0});
 expect(scenario.hosting.deploy).not.toHaveBeenCalled();
},30000);
it('verifies an independently authorized disable across the full roster on the same deployment',async()=>{
 const scenario=await fixture({operation:'disable',unhealthy:true});const result=await executeExposure(scenario.input,scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport);
 expect(result.outcome).toBe('verified');expect(scenario.raw.environments.test.on).toBe(false);expect(scenario.patches()).toBe(1);
 const record=await loadExposureRecord(result.recordPath);expect(record.featureProof?.measurement).toMatchObject({requests:1160,failures:0});expect(record.featureProof?.subject.deploymentId).toBe(scenario.request.deploymentId);expect(scenario.hosting.deploy).not.toHaveBeenCalled();
},30000);

it('derives a source-free observation subject from homogeneous real response identities',async()=>{
 const scenario=await fixture();
 const {execute}=await import('../tools/operations.js');
 const {loadRecord}=await import('../tools/evidence.js');
 const result=await execute({operation:'observe',targetName:'staging',target:scenario.request.target,durationSeconds:0.1,rate:10,maxRequests:1},scenario.hosting,join(scenario.root,'work'),scenario.transport,scenario.flags);
 expect(result.outcome).toBe('verified');
 const record=await loadRecord(result.recordPath);
 expect(record.requestedSourceSha).toBe(scenario.request.sourceSha);
 expect(record.observations).toContainEqual(expect.objectContaining({phase:'feature-proof',proof:expect.objectContaining({subject:expect.objectContaining({sourceSha:scenario.request.sourceSha}),measurement:expect.objectContaining({requests:1160,failures:0})})}));
 expect(scenario.patches()).toBe(0);expect(scenario.hosting.deploy).not.toHaveBeenCalled();
},30000);

it('rejects read-only internal observation evidence as authority for five-percent expansion',async()=>{
 const scenario=await fixture({stage:'5',priorOperation:'observe-exposure'});
 await expect(verifyExposureRelease(scenario.root)).rejects.toMatchObject({code:'EXPOSURE_AUTHORITY_REQUIRED'});
 expect(scenario.patches()).toBe(0);
});
it.each(['expired','query-baseline','wrong-subject','wrong-predecessor','edited-attachment'] as const)('sends no PATCH when predecessor evidence is %s',async fault=>{
 const scenario=await fixture({stage:'25'});
 const path=join(scenario.root,'prior-exposure.json');
 const prior=JSON.parse(await readFile(path,'utf8'));
 if(fault==='expired'){
  vi.setSystemTime(Date.now()+31*60000);Object.assign(scenario.request,requestValidity());
 }else if(fault==='query-baseline')prior.record.featureProof.baselineQueryP95Ms.workspace=200;
 else if(fault==='wrong-subject')prior.record.featureProof.subject.deploymentId=randomUUID();
 else if(fault==='wrong-predecessor'){
  const subject=prior.record.featureProof.subject;
  prior.record.featureProof=featureFixture(subject,'internal');
  prior.record.request.stage='internal';prior.record.request.before=featureFixture(subject,'off').before;
  prior.record.request.desired=desiredFlagState(prior.record.request.before,'internal');
  prior.record.requestDigest=sha256(serializeExposure(prior.record.request));prior.context.requestDigest=prior.record.requestDigest;
 }
 const bytes=JSON.stringify(prior)+(fault==='edited-attachment'?' ':'');await writeFile(path,bytes);
 if(fault!=='edited-attachment')scenario.request.attachments.find(file=>file.name==='prior-exposure.json')!.sha256=sha256(bytes);
 await writeFile(join(scenario.root,'exposure-request.json'),serializeExposure(scenario.request));
 await expect(executeExposure(scenario.input,scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport)).rejects.toMatchObject({code:{expired:'EXPOSURE_WINDOW','query-baseline':'EXPOSURE_PROOF_REJECTED','wrong-subject':'EXPOSURE_PROOF_REJECTED','wrong-predecessor':'EXPOSURE_PROOF_STALE','edited-attachment':'EXPOSURE_ATTACHMENT_CHANGED'}[fault]});
 expect(scenario.patches()).toBe(0);
});
it.each([false,true])('accepts authorized internal exposure evidence, reconciled=%s',async reconciled=>{
 const scenario=await fixture({stage:'5',reconciled});
 await expect(verifyExposureRelease(scenario.root)).resolves.toMatchObject({request:{stage:'5'}});
 expect(scenario.patches()).toBe(0);
});

it('rehearses one acknowledged flag effect and read-only recovery through the protected execution path',async()=>{
 const scenario=await fixture({rehearsal:true}),work=join(scenario.root,'work');
 const result=await rehearseExposureRecovery(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 expect(result.outcome).toBe('verified');expect(scenario.patches()).toBe(1);
 expect(result.rehearsal).toMatchObject({simulatedFailure:true,updateCalls:1,originalRecordUnchanged:true,lockReleased:true});
 const record=await loadExposureRecord(result.recordPath);
 expect(record.operation).toBe('reconcile-exposure');expect(record.request.purpose).toBe('response-loss-rehearsal');
 expect(record.featureProof?.measurement).toMatchObject({requests:120,failures:0});
 expect(scenario.hosting.deploy).not.toHaveBeenCalled();expect(scenario.hosting.updateImage).not.toHaveBeenCalled();
 expect(createExposureEnvelope(record,scenario.request.operator).record.reconciles).toBe(result.rehearsal.originalAttemptId);
},30000);
it('refuses a rehearsal when the approved request did not declare the failure fixture',async()=>{
 const scenario=await fixture();
 await expect(rehearseExposureRecovery({...scenario.input,rehearseResponseLoss:true},scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport)).rejects.toMatchObject({code:'EXPOSURE_SUBJECT_CHANGED'});
 expect(scenario.patches()).toBe(0);
});
it.each([{targetName:'live' as const},{stage:'5' as const},{apply:false}])('forbids response-loss rehearsal outside an applied internal staging exposure: %j',async change=>{
 const scenario=await fixture({rehearsal:true});
 await expect(rehearseExposureRecovery({...scenario.input,...change},scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport)).rejects.toMatchObject({code:'REHEARSAL_TARGET_REJECTED'});
 expect(scenario.patches()).toBe(0);
});

it('reconciles an applied but unhealthy flag and releases only its owned lock without rewriting uncertainty',async()=>{
 const scenario=await fixture({lost:true,unhealthy:true}),work=join(scenario.root,'work');
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 const bytes=await readFile(original.recordPath);
 const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(recovered.outcome).toBe('blocked');expect(recovered.recoveryInstruction).toContain('Independently authorize disable');
 expect(scenario.patches()).toBe(1);expect(await readFile(original.recordPath)).toEqual(bytes);expect(await readLockOwner(work, scenario.request.target)).toEqual(undefined);
 const record=await loadExposureRecord(recovered.recordPath);expect(()=>createExposureEnvelope(record,scenario.request.operator)).toThrow();
},30000);

it.each(['5','25','100'] as const)('executes authorized %s exposure with a current immediate predecessor',async stage=>{
 const scenario=await fixture({stage}),work=join(scenario.root,'work');
 const result=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 expect(result.outcome).toBe('verified');expect(scenario.patches()).toBe(1);
 const record=await loadExposureRecord(result.recordPath);expect(record.featureProof?.after.stage).toBe(stage);
 if(stage==='100')expect(record.featureProof?.measurement).toMatchObject({distinct:{eligibleTrue:1000,eligibleFalse:0,excludedFalse:20}});
},30000);

it('holds a cohort reshuffle even when the expanded population passes its independent health gates',async()=>{
 const scenario=await fixture({stage:'25',regressedMembership:true});
 const result=await executeExposure(scenario.input,scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport);
 expect(result.outcome).toBe('blocked');expect(result.recoveryInstruction).toContain('Previously treated');
 expect(scenario.patches()).toBe(1);const record=await loadExposureRecord(result.recordPath);expect(()=>createExposureEnvelope(record,scenario.request.operator)).toThrow();
 const diagnostic=inspectExposureDiagnostic(createExposureDiagnostic(record,scenario.request.operator));
 expect(diagnostic.featureAssessment.outcome).toBe('verified');expect(diagnostic.recordedOutcome).toBe('blocked');
 expect(diagnostic.recordedReasonCodes).toEqual(['EXPOSURE_HOLD']);expect(diagnostic.recoveryInstruction).toContain('Previously treated');
},30000);

it.each([
 ['-intent.json','open',false], ['-intent.json','writeFile',false], ['-intent.json','sync',false], ['-intent.json','close',false],
 ['-submitted.json','open',false], ['-acknowledged.json','open',true], ['-request.json','open',true],
 ['exposure-record.json','open',true], ['exposure-record.json','writeFile',true], ['exposure-record.json','sync',true], ['exposure-record.json','close',true],
 ['exposure-record.json.sha256','open',true],
] as const)('retains the correct effect certainty when %s fails at %s',async(suffix,action,effected)=>{
 const scenario=await fixture(),work=join(scenario.root,'work');
 const open=fs.open;
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{
  const matches=String(args[0]).includes('/attempts/')&&!String(args[0]).includes('/release/')&&String(args[0]).endsWith(suffix);
  if(matches&&action==='open')throw new Error('Injected durable I/O failure');
  const handle=await open(...args);
  if(!matches)return handle;
  return new Proxy(handle,{get(target,key){
   if(key===action)return async()=>{if(key==='close')await target.close();throw new Error('Injected durable I/O failure');};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
 });
 let result:Awaited<ReturnType<typeof executeExposure>>|undefined;
 try{result=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);}catch(error){expect(String(error)).toContain('Injected durable I/O failure');}
 spy.mockRestore();
 expect(scenario.patches()).toBe(effected?1:0);
 expect(await readLockOwner(work, scenario.request.target)).toEqual(effected ? expect.any(String) : undefined);
 if(result)expect(result.outcome).toBe(effected?'unknown_outcome':'blocked');
 if(suffix==='exposure-record.json.sha256'){
  const attempts=await readdir(join(work,'exposure/attempts'));expect(attempts).toHaveLength(1);
  const originalPath=join(work,'exposure/attempts',attempts[0]!,'exposure-record.json'),bytes=await readFile(originalPath);
  const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:attempts[0]!},scenario.hosting,scenario.flags,work,scenario.transport);
  expect(recovered.outcome).toBe('verified');expect(scenario.patches()).toBe(1);expect(await readFile(originalPath)).toEqual(bytes);expect(await readLockOwner(work, scenario.request.target)).toEqual(undefined);
 }
},30000);

it('does not clear another attempt owner during unhealthy reconciliation',async()=>{
 const scenario=await fixture({lost:true,unhealthy:true}),work=join(scenario.root,'work');
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 const other=randomUUID();await releaseReconciledLock(work,scenario.request.target,original.attemptId!);await acquireLock(work,scenario.request.target,other);
 const result=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(result.outcome).toBe('blocked');expect(await readLockOwner(work,scenario.request.target)).toBe(other);expect(scenario.patches()).toBe(1);
},30000);

it('recovers a completed flag change whose owned lock survived cleanup failure', async () => {
 const scenario=await fixture(),work=join(scenario.root,'work');
 const unlink=fs.unlink;
 const cleanup=vi.spyOn(fs,'unlink').mockImplementation(async path=>{
  if(String(path).endsWith('.lock'))throw Object.assign(new Error('Injected lock cleanup failure'), { code: 'EACCES' });
  return unlink(path);
 });
 const completed=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 expect(completed).toMatchObject({outcome:'verified',cleanupWarning:{code:'LOCK_CLEANUP_REQUIRED',causeCode:'EACCES'}});
 expect(completed.cleanupWarning?.recoveryInstruction).toContain(completed.attemptId!);
 cleanup.mockRestore();
 const [attempt]=await readdir(join(work,'exposure/attempts'));
 const path=join(work,'exposure/attempts',attempt!,'exposure-record.json'),bytes=await readFile(path);
 expect((await loadExposureRecord(path)).outcome).toBe('verified');
 const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:attempt!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(recovered.outcome).toBe('verified');expect(await readLockOwner(work, scenario.request.target)).toEqual(undefined);
 expect(await readFile(path)).toEqual(bytes);expect(scenario.patches()).toBe(1);
},30000);

it.each(['missing','another owner'])('rejects completed exposure reconciliation when its lock has %s',async ownership=>{
 const scenario=await fixture(),work=join(scenario.root,'work');
 const completed=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 if(ownership==='another owner')await acquireLock(work,scenario.request.target,randomUUID());
 await expect(executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:completed.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport)).rejects.toMatchObject({code:'NOT_UNCERTAIN'});
 expect(scenario.patches()).toBe(1);expect(await readLockOwner(work, scenario.request.target)).toEqual(ownership === 'missing' ? undefined : expect.any(String));
},30000);

it('clears a completed conditional rejection without requiring its unapplied flag state',async()=>{
 const scenario=await fixture({conflict:true}),work=join(scenario.root,'work');
 const unlink=fs.unlink;
 const cleanup=vi.spyOn(fs,'unlink').mockImplementation(async path=>{
  if(String(path).endsWith('.lock'))throw Object.assign(new Error('Injected lock cleanup failure'), { code: 'EACCES' });
  return unlink(path);
 });
 const rejected=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 cleanup.mockRestore();
 expect(rejected).toMatchObject({outcome:'blocked',reasonCodes:['FLAG_CONFLICT'],cleanupWarning:{code:'LOCK_CLEANUP_REQUIRED',causeCode:'EACCES'}});
 const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:rejected.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(recovered.outcome).toBe('blocked');expect(recovered.reasonCodes).toContain('COMPLETED_ATTEMPT_CLEANUP');
 expect(await readLockOwner(work, scenario.request.target)).toEqual(undefined);expect(scenario.patches()).toBe(1);
 expect((await loadExposureRecord(recovered.recordPath)).featureProof).toBeNull();
});

it.each(['hosting scope','flag scope','hosting snapshot','flag snapshot'])('preserves the original exposure recovery command after failed %s preflight',async phase=>{
 const scenario=await fixture({conflict:true}),work=join(scenario.root,'work');
 const unlink=fs.unlink;
 const cleanup=vi.spyOn(fs,'unlink').mockImplementation(async path=>{
  if(String(path).endsWith('.lock'))throw Object.assign(new Error('Injected lock cleanup failure'),{code:'EACCES'});
  return unlink(path);
 });
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 cleanup.mockRestore();
 const bytes=await readFile(original.recordPath);
 const error=new LabError('PROVIDER_REJECTED','Synthetic preflight rejection.');
 const failure=phase==='hosting scope'?vi.spyOn(scenario.hosting,'assertScope').mockRejectedValue(error)
  :phase==='flag scope'?vi.spyOn(scenario.flags,'assertScope').mockRejectedValue(error)
  :phase==='hosting snapshot'?vi.spyOn(scenario.hosting,'snapshot').mockRejectedValue(error)
  :vi.spyOn(scenario.flags,'snapshot').mockRejectedValue(error);
 await expect(executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport)).rejects.toMatchObject({code:'PROVIDER_REJECTED',recoveryCommand:expect.stringContaining(`reconcile-exposure --target staging --attempt ${original.attemptId}`)});
 expect(await readLockOwner(work, scenario.request.target)).toEqual(expect.any(String));expect(await readFile(original.recordPath)).toEqual(bytes);
 failure.mockRestore();
 const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(recovered).toMatchObject({outcome:'blocked',reasonCodes:['COMPLETED_ATTEMPT_CLEANUP']});
 expect(await readLockOwner(work, scenario.request.target)).toEqual(undefined);expect(scenario.patches()).toBe(1);
 expect(await readFile(original.recordPath)).toEqual(bytes);
});

it.each(['record','intent'])('rejects exposure %s copied under another attempt UUID',async format=>{
 const scenario=await fixture({lost:true}),work=join(scenario.root,'work');
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 const copied=randomUUID(),directory=join(work,'exposure/attempts',copied);
 await cp(join(work,'exposure/attempts',original.attemptId!),directory,{recursive:true});
 if(format==='intent'){
  await rm(join(directory,'exposure-record.json'));await rm(join(directory,'exposure-record.json.sha256'));
 }
 const patches=scenario.patches();
 await expect(executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:copied},scenario.hosting,scenario.flags,work,scenario.transport)).rejects.toMatchObject({code:'ATTEMPT_IDENTITY_MISMATCH'});
 expect(scenario.patches()).toBe(patches);expect(await readLockOwner(work, scenario.request.target)).toEqual(expect.any(String));
});

it('clears a pre-effect flag rejection after hosting drift without issuing eligibility',async()=>{
 const scenario=await fixture(),work=join(scenario.root,'work');
 const before=await scenario.hosting.snapshot();
 scenario.hosting.snapshot=vi.fn().mockResolvedValueOnce(before).mockResolvedValue({...before,configurationFingerprint:'f'.repeat(64)});
 const unlink=fs.unlink;
 const cleanup=vi.spyOn(fs,'unlink').mockImplementation(async path=>{
  if(String(path).endsWith('.lock'))throw Object.assign(new Error('Injected lock cleanup failure'),{code:'EACCES'});
  return unlink(path);
 });
 const rejected=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 cleanup.mockRestore();
 expect(rejected).toMatchObject({outcome:'blocked',reasonCodes:['EXPOSURE_SUBJECT_CHANGED'],cleanupWarning:{code:'LOCK_CLEANUP_REQUIRED'}});
 const original=await readFile(rejected.recordPath);
 const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:rejected.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(recovered).toMatchObject({outcome:'blocked',reasonCodes:['COMPLETED_ATTEMPT_CLEANUP']});
 const record=await loadExposureRecord(recovered.recordPath);
 expect(record.featureProof).toBeNull();expect(()=>createExposureEnvelope(record,scenario.request.operator)).toThrow();
 expect(await readLockOwner(work, scenario.request.target)).toEqual(undefined);expect(scenario.patches()).toBe(0);
 expect(await readFile(rejected.recordPath)).toEqual(original);
});

it('retains an unknown flag effect when the hosting subject drifts',async()=>{
 const scenario=await fixture({lost:true}),work=join(scenario.root,'work');
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 const bytes=await readFile(original.recordPath),before=await scenario.hosting.snapshot();
 scenario.hosting.snapshot=vi.fn(async()=>({...before,configurationFingerprint:'f'.repeat(64)}));
 await expect(executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport)).rejects.toMatchObject({code:'EXPOSURE_SUBJECT_CHANGED'});
 expect(await readLockOwner(work, scenario.request.target)).toEqual(expect.any(String));expect(await readFile(original.recordPath)).toEqual(bytes);
 expect(scenario.patches()).toBe(1);
});

it.each(['configuration','flag'])('clears a previously verified exposure after %s drift without fresh proof',async drift=>{
 const scenario=await fixture(),work=join(scenario.root,'work'),nativeUnlink=fs.unlink;
 const cleanup=vi.spyOn(fs,'unlink').mockImplementation(async path=>{
  if(String(path).endsWith('.lock'))throw Object.assign(new Error('fixture retained terminal lock'),{code:'EACCES'});
  return nativeUnlink(path);
 });
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 cleanup.mockRestore();expect(original.outcome).toBe('verified');
 const bytes=await readFile(original.recordPath),before=await scenario.hosting.snapshot();
 if(drift==='configuration')scenario.hosting.snapshot=vi.fn(async()=>({...before,configurationFingerprint:'f'.repeat(64)}));
 else vi.spyOn(scenario.flags,'snapshot').mockResolvedValue(flagSnapshot(captured,'staging'));
 const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(recovered.outcome).toBe('blocked');expect(recovered.reasonCodes).toContain('COMPLETED_ATTEMPT_CLEANUP');
 expect(await readLockOwner(work,scenario.request.target)).toBeUndefined();expect(await readFile(original.recordPath)).toEqual(bytes);
 const record=await loadExposureRecord(recovered.recordPath);expect(record.featureProof).toBeNull();expect(()=>createExposureEnvelope(record,scenario.request.operator)).toThrow();
 expect(scenario.patches()).toBe(1);
},30000);

it.each(['-intent.json','-before-provider.json','-before-flag.json'])('retains a verified owner when durable readback fails at %s',async suffix=>{
 const scenario=await fixture(),work=join(scenario.root,'work'),nativeUnlink=fs.unlink;
 const cleanup=vi.spyOn(fs,'unlink').mockImplementation(async path=>{
  if(String(path).endsWith('.lock'))throw Object.assign(new Error('fixture retained terminal lock'),{code:'EACCES'});
  return nativeUnlink(path);
 });
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 cleanup.mockRestore();expect(original.outcome).toBe('verified');
 const bytes=await readFile(original.recordPath),nativeOpen=fs.open;
 const failure=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{
  if(String(args[0]).endsWith(suffix))throw new Error('fixture unsaved readback');
  return nativeOpen(...args);
 });
 const failed=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 failure.mockRestore();
 expect(failed.outcome).toBe('unknown_outcome');expect(failed.reasonCodes).not.toContain('COMPLETED_ATTEMPT_CLEANUP');
 expect(await readLockOwner(work,scenario.request.target)).toBe(original.attemptId);expect(await readFile(original.recordPath)).toEqual(bytes);
 const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(recovered.outcome).toBe('verified');expect(await readLockOwner(work,scenario.request.target)).toBeUndefined();expect(scenario.patches()).toBe(1);
},30000);
