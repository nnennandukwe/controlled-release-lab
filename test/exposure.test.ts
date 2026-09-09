import * as fs from 'node:fs/promises';
import { rehearseExposureRecovery } from '../tools/exposure-rehearsal.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { featureFixture } from './helpers/feature-fixture.js';
import { policy, policyDigest, requestValidity } from '../tools/promotion.js';
import { exposurePolicyDigest, rosterDigest } from '../tools/exposure-observe.js';
import { exposureRequestSchema, serializeExposure, executeExposure, loadExposureRecord, createExposureEnvelope, verifyExposureRelease } from '../tools/exposure.js';
import { desiredFlagState, LaunchDarkly } from '../tools/launchdarkly.js';
import { acquireLock } from '../tools/evidence.js';
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
 expect(result).toMatchObject({outcome:'blocked',reasonCodes:['FLAG_CONFLICT']});expect(scenario.patches()).toBe(1);expect(await readdir(join(scenario.root,'work/locks'))).toHaveLength(0);
});
it('retains a lost PATCH and shared lock, then reconciles real samples without repeating the effect',async()=>{
 const scenario=await fixture({lost:true}),work=join(scenario.root,'work');
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);expect(original.outcome).toBe('unknown_outcome');expect(scenario.patches()).toBe(1);
 const bytes=await readFile(original.recordPath);expect(await readdir(join(work,'locks'))).toHaveLength(1);
 await expect(acquireLock(work,scenario.request.target,randomUUID())).rejects.toMatchObject({code:'OPERATION_LOCKED'});
 const current=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(current.outcome).toBe('verified');expect(scenario.patches()).toBe(1);expect(await readFile(original.recordPath)).toEqual(bytes);expect(await readdir(join(work,'locks'))).toHaveLength(0);
 const record=await loadExposureRecord(current.recordPath);expect(record.featureProof?.measurement).toMatchObject({requests:120,failures:0});expect(createExposureEnvelope(record,scenario.request.operator).record.reconciles).toBe(original.attemptId);
},30000);
it('holds an unhealthy but known exposure without blocking a separately authorized disable',async()=>{
 const scenario=await fixture({unhealthy:true});const result=await executeExposure(scenario.input,scenario.hosting,scenario.flags,join(scenario.root,'work'),scenario.transport);
 expect(result.outcome).toBe('blocked');expect(await readdir(join(scenario.root,'work/locks'))).toHaveLength(0);
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
 expect(scenario.patches()).toBe(1);expect(await readFile(original.recordPath)).toEqual(bytes);expect(await readdir(join(work,'locks'))).toHaveLength(0);
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
 expect(await readdir(join(work,'locks'))).toHaveLength(effected?1:0);
 if(result)expect(result.outcome).toBe(effected?'unknown_outcome':'blocked');
 if(suffix==='exposure-record.json.sha256'){
  const attempts=await readdir(join(work,'exposure/attempts'));expect(attempts).toHaveLength(1);
  const originalPath=join(work,'exposure/attempts',attempts[0]!,'exposure-record.json'),bytes=await readFile(originalPath);
  const recovered=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:attempts[0]!},scenario.hosting,scenario.flags,work,scenario.transport);
  expect(recovered.outcome).toBe('verified');expect(scenario.patches()).toBe(1);expect(await readFile(originalPath)).toEqual(bytes);expect(await readdir(join(work,'locks'))).toHaveLength(0);
 }
},30000);

it('does not clear another attempt owner during unhealthy reconciliation',async()=>{
 const scenario=await fixture({lost:true,unhealthy:true}),work=join(scenario.root,'work');
 const original=await executeExposure(scenario.input,scenario.hosting,scenario.flags,work,scenario.transport);
 const locks=await readdir(join(work,'locks')),other=randomUUID();await writeFile(join(work,'locks',locks[0]!),other);
 const result=await executeExposure({operation:'reconcile-exposure',targetName:'staging',attempt:original.attemptId!},scenario.hosting,scenario.flags,work,scenario.transport);
 expect(result.outcome).toBe('blocked');expect(await readFile(join(work,'locks',locks[0]!), 'utf8')).toBe(other);expect(scenario.patches()).toBe(1);
},30000);
