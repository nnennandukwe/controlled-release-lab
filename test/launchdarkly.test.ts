import {expect,it,vi} from 'vitest';
import {LaunchDarkly, flagSnapshot, desiredFlagState} from '../tools/launchdarkly.js';
import captured from './fixtures/launchdarkly-off.json' with {type:'json'};
import refusal from './fixtures/launchdarkly-version-refusal.json' with {type:'json'};
function provider(patchResponse: () => Promise<Response>, options: { differentAccount?: boolean; unrelatedWriterProject?: boolean; writerDrift?: boolean; differentFlag?: boolean } = {}) {
 return vi.fn<typeof fetch>(async (input, init) => {
  if (init?.method === 'PATCH') return patchResponse();
  const writer = (init?.headers as Record<string,string>).Authorization?.startsWith('writ') ?? false;
  const url = String(input);
  if (url.endsWith('/caller-identity')) return Response.json({accountId: writer && options.differentAccount ? 'other-account' : 'lab-account', serviceToken: writer});
  if (url.includes('/projects?')) return Response.json({items: [{key: 'default'}, ...(writer && options.unrelatedWriterProject ? [{key: 'unrelated'}] : [])]});
  if (url.includes('/flags/default?')) return Response.json({items: [{key: 'catalog-ranked-search'}]});
  const current = structuredClone(captured);
  if (options.differentFlag) current.variations[0]!._id='different-flag-variation';
  if (writer && options.writerDrift) current.environments.test.version++;
  return Response.json(current);
 });
}
const patchCalls = (transport: ReturnType<typeof provider>) => transport.mock.calls.filter(([, init]) => init?.method === 'PATCH');
it('reads the captured environment and binds full targeting state',async()=>{
 const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json(captured));
 const flag=await new LaunchDarkly('reader',undefined,'staging',transport).snapshot();
 expect(flag.environmentKey).toBe('test');expect(flag.version).toBe(2);expect(flag.state.on).toBe(false);
 expect(flag.digest).not.toBe(flagSnapshot(captured,'live').digest);
 const drift=structuredClone(captured);drift.environments.test.salt='different';expect(flagSnapshot(drift,'staging').digest).not.toBe(flag.digest);
});
it('sends one atomic version and state conditional PATCH to the fixed flag',async()=>{
 const before=flagSnapshot(captured,'staging');const after=structuredClone(captured);after.environments.test.on=true;after.environments.test.version++;
 const transport=provider(async()=>Response.json(after));
 await new LaunchDarkly('reader','writer','staging',transport).update(before,'internal');
 expect(patchCalls(transport)).toHaveLength(1);const [url,input]=patchCalls(transport)[0]!;
 expect(url).toBe('https://app.launchdarkly.com/api/v2/flags/default/catalog-ranked-search');
 const patch=JSON.parse(String(input?.body));expect(patch).toContainEqual({op:'test',path:'/environments/test/version',value:2});
 expect(patch).toContainEqual({op:'test',path:'/environments/test/rules',value:captured.environments.test.rules});
 expect(patch.at(-1)).toEqual({op:'replace',path:'/environments/test/on',value:true});
 expect((input?.headers as Record<string,string>).Authorization).toBe('writer');
});
it('refuses the captured provider conflict and never retries a lost write',async()=>{
 expect(refusal).toMatchObject({httpStatus:409,unchanged:true,afterOn:false});
 const conflict=provider(async()=>Response.json({code:refusal.code},{status:409}));
 await expect(new LaunchDarkly('read','write','staging',conflict).update(flagSnapshot(captured,'staging'),'internal')).rejects.toMatchObject({code:'FLAG_CONFLICT',outcome:'blocked'});
 expect(patchCalls(conflict)).toHaveLength(1);
 const lost=provider(async()=>{throw new Error('contains-token-do-not-print');});
 await expect(new LaunchDarkly('read','write','staging',lost).update(flagSnapshot(captured,'staging'),'internal')).rejects.toMatchObject({code:'FLAG_TRANSPORT',outcome:'unknown_outcome'});expect(patchCalls(lost)).toHaveLength(1);
});
it('rejects missing Writer, another subject, unknown targeting, and unsupported transitions before PATCH',async()=>{
 const transport=vi.fn<typeof fetch>();const before=flagSnapshot(captured,'staging');
 await expect(new LaunchDarkly('read',undefined,'staging',transport).update(before,'internal')).rejects.toMatchObject({code:'MISSING_FLAG_WRITER'});
 await expect(new LaunchDarkly('read','write','live',transport).update(before,'internal')).rejects.toMatchObject({code:'FLAG_SUBJECT'});
 expect(()=>desiredFlagState(before,'5')).toThrow();
 const drift=structuredClone(captured);drift.environments.test.fallthrough.variation=1;expect(()=>flagSnapshot(drift,'staging')).toThrow();
 expect(transport).not.toHaveBeenCalled();
});
it('allows an independent off transition from internal or five percent while preserving the definition',()=>{
 const internal=structuredClone(captured);internal.environments.test.on=true;const snapshot=flagSnapshot(internal,'staging');
 const five=desiredFlagState(snapshot,'5');expect(five.rules).toHaveLength(3);expect(five.rules[2]?.rollout).toEqual({contextKind:'user',bucketBy:'key',variations:[{variation:1,weight:5000},{variation:0,weight:95000}]});
 expect(desiredFlagState(snapshot,'off')).toEqual({...snapshot.state,on:false});
});

it.each(['differentAccount', 'unrelatedWriterProject', 'writerDrift'] as const)('rejects %s before using the Writer for PATCH', async mismatch => {
 const transport = provider(async()=>Response.json(captured), {[mismatch]:true});
 await expect(new LaunchDarkly('reader','writer','staging',transport).update(flagSnapshot(captured,'staging'),'internal')).rejects.toMatchObject({code: mismatch === 'writerDrift' ? 'FLAG_STATE_CHANGED' : 'FLAG_ACCOUNT_SCOPE'});
 expect(patchCalls(transport)).toHaveLength(0);
});
it.each([429,502,503,504])('blocks HTTP %s reads without retrying or using the Writer', async status => {
 const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, {status}));
 await expect(new LaunchDarkly('reader','writer','staging',transport).snapshot()).rejects.toMatchObject({code:'FLAG_HTTP',outcome:'blocked'});
 expect(transport).toHaveBeenCalledOnce();
 expect(transport.mock.calls[0]![1]?.method).toBe('GET');
 expect((transport.mock.calls[0]![1]?.headers as Record<string,string>).Authorization).toBe('reader');
});

it('rejects a different account-specific flag identity even when both credentials agree',async()=>{
 const transport=provider(async()=>Response.json(captured),{differentFlag:true});
 const flags=new LaunchDarkly('reader','writer','staging',transport);
 await expect(flags.snapshot()).rejects.toMatchObject({code:'FLAG_SUBJECT'});
 await expect(flags.update(flagSnapshot(captured,'staging'),'internal')).rejects.toMatchObject({code:'FLAG_SUBJECT'});
 expect(patchCalls(transport)).toHaveLength(0);
});
