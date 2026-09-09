import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {exposureSequence, assessExposure, type ExposureSample} from '../tools/exposure-observe.js';
import {flagSnapshot} from '../tools/launchdarkly.js';
import {syntheticContext} from '../src/flags.js';
import fixture from './fixtures/launchdarkly-off.json' with {type:'json'};
const subject={sourceSha:'a'.repeat(40),deploymentId:'44444444-4444-4444-8444-444444444444',targetName:'staging' as const};
function evidence(stage:'off'|'internal'|'5'){
 const rawFlag=structuredClone(fixture);rawFlag.environments.test.on=stage!=='off';const flag=flagSnapshot(rawFlag,'staging');
 const samples=exposureSequence(stage).map(({contextKey,query}):ExposureSample=>{
  const context=syntheticContext(contextKey);const value=stage!=='off'&&(context.cohort==='internal'||stage==='5'&&context.cohort==='eligible'&&Number(context.key.slice(-4))<=50);
  return{index:0,contextKey,query,requestId:randomUUID(),durationMs:20,status:200,error:null,sourceSha:subject.sourceSha,deploymentId:subject.deploymentId,environment:'staging',ranking:value?'ranked':'original',results:query==='keyboard'?(value?['keyboard-full','keyboard-compact']:['keyboard-compact','keyboard-full']):(value?['keyboard-compact','headphones-travel']:['headphones-travel','keyboard-compact']),evaluation:{flagKey:'catalog-ranked-search',contextKey,cohort:context.cohort,eligible:context.eligible,value,variationIndex:value?1:0,reason:{kind:stage==='off'?'OFF':context.cohort==='eligible'&&stage==='internal'?'FALLTHROUGH':'RULE_MATCH',...((stage!=='off'&&context.cohort!=='eligible')?{ruleId:flag.state.rules[context.cohort==='internal'?1:0]!._id!}:{})},fallbackUsed:false,sdkInitialized:true}};
 });samples.forEach((sample,i)=>sample.index=i);return{flag,samples};
}
it('fixes the complete roster and paired queries before collecting observations',()=>{
 const five=exposureSequence('5');expect(five).toHaveLength(1160);expect(new Set(five.map(sample=>sample.contextKey)).size).toBe(1040);expect(exposureSequence('off')).toEqual(five);expect(exposureSequence('internal')).toHaveLength(120);
});
it('requires independent internal treatment/control and all failures remain visible',()=>{
 const {flag,samples}=evidence('internal');expect(assessExposure(samples,flag,subject,60000,100)).toMatchObject({outcome:'verified',distinct:{internalTrue:20,excludedFalse:20,eligibleFalse:20}});
 samples[0]!.evaluation!.fallbackUsed=true;
 expect(assessExposure(samples,flag,subject,60000,100)).toMatchObject({outcome:'blocked',failures:1});
});
it('holds absent cohorts, shortened windows, mixed identities and repeated request IDs',()=>{
 const {flag,samples}=evidence('internal');
 expect(assessExposure(samples.slice(0,10),flag,subject,60000,100).reasonCodes).toContain('INSUFFICIENT_SAMPLES');
 expect(assessExposure(samples,flag,subject,59999,100).reasonCodes).toContain('SHORT_WINDOW');
 samples[0]!.deploymentId='55555555-5555-4555-8555-555555555555';samples[1]!.requestId=samples[2]!.requestId;
 expect(assessExposure(samples,flag,subject,60000,100).reasonCodes).toEqual(expect.arrayContaining(['INVALID_SAMPLES','DUPLICATE_REQUESTS']));
});
it('does not turn original fallback responses into verified disablement or lose latency regressions',()=>{
 const {flag,samples}=evidence('off');expect(assessExposure(samples,flag,subject,120000,20).outcome).toBe('verified');
 for(const sample of samples)sample.durationMs=600;
 expect(assessExposure(samples,flag,subject,120000,20).reasonCodes).toContain('LATENCY_HOLD');
 samples[0]!.evaluation!.reason={kind:'ERROR',errorKind:'CLIENT_NOT_READY'};samples[0]!.evaluation!.fallbackUsed=true;
 expect(assessExposure(samples,flag,subject,120000,20).outcome).toBe('blocked');
});

import { featureFixture } from './helpers/feature-fixture.js';
import { policy } from '../tools/promotion.js';
import { checkFeatureProof } from '../tools/feature-proof.js';
it('requires eligible treatment instead of counting internal traffic toward the five-percent denominator',()=>{
 const proof=featureFixture({...subject,image:`ghcr.io/${policy.repository}@sha256:${'a'.repeat(64)}`,target:policy.targets.staging,configurationFingerprint:policy.configurationFingerprints.staging},'5');
 const measured=checkFeatureProof(proof,proof.subject,'both');expect(measured.measurement.distinct).toMatchObject({internalTrue:20,eligibleTrue:50,eligibleFalse:950});
 const samples=(proof.measurement as {samples:ExposureSample[]}).samples;
 for(const sample of samples)if(sample.evaluation?.cohort==='eligible'){sample.evaluation.value=false;sample.evaluation.variationIndex=0;sample.ranking='original';sample.results=sample.query==='keyboard'?['keyboard-compact','keyboard-full']:['headphones-travel','keyboard-compact'];}
 expect(()=>checkFeatureProof(proof,proof.subject,'both')).toThrow('INSUFFICIENT_ELIGIBLE_COHORTS');
});
