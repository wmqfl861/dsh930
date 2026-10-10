import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadTeam,copy,digest} from '../core.mjs';
import {runGeneratedTeam} from '../generated-team.mjs';
import {RunStore} from '../runner.mjs';
import {fixtureConfig,fixtureCandidate,fixtureExecutor} from '../fixtures.mjs';
const loaded=await loadTeam();
async function setup(t){
 const directory=await mkdtemp(join(tmpdir(),'alpha-invocation-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const candidate=fixtureCandidate({goal:'Compare supplied evidence',acceptance:['Trace requirements']});
 const args={...loaded,candidate,config:fixtureConfig(loaded.team),operationId:'explicit-user-operation',executor:fixtureExecutor()};
 return {directory,args,invoke:(overrides={})=>runGeneratedTeam({...args,...overrides,store:new RunStore(directory)})};
}
const recordPath=(directory,id)=>join(directory,'operation-'+digest(id)+'.operation');

test('operation ID is explicit and bounded before any child dispatch',async t=>{
 const {invoke}=await setup(t);let calls=0;
 for(const operationId of [undefined,'','../escape','a'.repeat(129)])await assert.rejects(invoke({operationId,executor:fixtureExecutor(()=>calls++)}),{code:'OPERATION_ID'});
 assert.equal(calls,0);
});
test('sequential duplicate returns identical durable result without another preflight or delegation',async t=>{
 const {invoke,directory,args}=await setup(t);let calls=0,preflights=0;const executor=fixtureExecutor(()=>calls++);executor.preflight=()=>preflights++;
 const first=await invoke({executor});const second=await invoke({executor});
 assert.deepEqual(second,first);assert.equal(calls,3);assert.equal(preflights,1);
 assert.equal((await readdir(directory)).filter(name=>name.endsWith('.json')).length,1);
 const record=JSON.parse(await readFile(recordPath(directory,args.operationId),'utf8'));assert.equal(record.status,'completed');assert.deepEqual(record.result,first);assert.equal(record.resultHash,digest(first));
 second.outputs.s1.modified=true;assert.deepEqual(await invoke({executor}),first);
});
test('concurrent duplicate cannot dispatch while the original reservation is active',async t=>{
 const {invoke,directory,args}=await setup(t);const ready=Promise.withResolvers(),release=Promise.withResolvers();let calls=0;
 const executor=fixtureExecutor(async()=>{if(++calls===2)ready.resolve();await release.promise;});
 const first=invoke({executor});await ready.promise;
 const reserved=JSON.parse(await readFile(recordPath(directory,args.operationId),'utf8'));assert.equal(reserved.status,'reserved');assert.match(reserved.fingerprint,/^[a-f0-9]{64}$/);
 try {await assert.rejects(invoke({executor}),{code:'OPERATION_UNRESOLVED'});assert.equal(calls,2);} finally {release.resolve();}
 await first;assert.equal(calls,3);
});
test('blueprint, constraints and configured route changes reject reuse',async t=>{
 const {invoke,args}=await setup(t);await invoke();let calls=0;const executor=fixtureExecutor(()=>calls++);
 const candidate=copy(args.candidate);candidate.objective+=' changed';await assert.rejects(invoke({candidate,executor}),{code:'OPERATION_MISMATCH'});
 await assert.rejects(invoke({constraints:['New constraint'],executor}),{code:'OPERATION_MISMATCH'});
 const config=copy(args.config);config.models[0].maxTokens++;await assert.rejects(invoke({config,executor}),{code:'OPERATION_MISMATCH'});assert.equal(calls,0);
});
test('fixture result cannot be reused as a live-mode invocation',async t=>{
 const {invoke}=await setup(t);await invoke();const executor=fixtureExecutor();executor.mode='dsh';await assert.rejects(invoke({executor}),{code:'OPERATION_MISMATCH'});
});
test('failed and cancelled invocation IDs remain closed; an intentional new ID permits a new run',async t=>{
 const {invoke,directory,args}=await setup(t);let calls=0;const executor=fixtureExecutor(()=>{calls++;throw new Error('provider failure');});
 await assert.rejects(invoke({executor}),/provider failure/);const failedCalls=calls;
 await assert.rejects(invoke({executor}),{code:'OPERATION_UNRESOLVED'});assert.equal(calls,failedCalls);
 assert.equal(JSON.parse(await readFile(recordPath(directory,args.operationId),'utf8')).status,'failed');
 const fresh=await invoke({operationId:'intentional-new-attempt'});assert.equal(fresh.status,'fixture_complete');
 const ctl=new AbortController();const cancelExecutor=fixtureExecutor(()=>{ctl.abort(new Error('cancelled'));});
 await assert.rejects(invoke({operationId:'cancel-attempt',executor:cancelExecutor,signal:ctl.signal}),/cancelled/);
 await assert.rejects(invoke({operationId:'cancel-attempt'}),{code:'OPERATION_UNRESOLVED'});
});
test('process crash after reservation leaves unknown outcome closed across a fresh process',async t=>{
 const {directory,args,invoke}=await setup(t);
 const script=`import {loadTeam} from ${JSON.stringify(new URL('../core.mjs',import.meta.url).href)};
 import {runGeneratedTeam} from ${JSON.stringify(new URL('../generated-team.mjs',import.meta.url).href)};
 import {RunStore} from ${JSON.stringify(new URL('../runner.mjs',import.meta.url).href)};
 import {fixtureConfig,fixtureCandidate,fixtureExecutor} from ${JSON.stringify(new URL('../fixtures.mjs',import.meta.url).href)};
 const loaded=await loadTeam();const executor=fixtureExecutor();executor.preflight=()=>process.exit(17);
 await runGeneratedTeam({...loaded,candidate:${JSON.stringify(args.candidate)},config:fixtureConfig(loaded.team),operationId:${JSON.stringify(args.operationId)},store:new RunStore(${JSON.stringify(directory)}),executor});`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|PASSWORD|SECRET|TOKEN/i.test(key)))});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,17,child.stderr);
 const record=JSON.parse(await readFile(recordPath(directory,args.operationId),'utf8'));assert.equal(record.status,'reserved');
 let calls=0;await assert.rejects(invoke({executor:fixtureExecutor(()=>calls++)}),{code:'OPERATION_UNRESOLVED'});assert.equal(calls,0);
});
test('partial reservation and damaged completion fail closed without dispatch',async t=>{
 const {directory,args,invoke}=await setup(t);let calls=0;const executor=fixtureExecutor(()=>calls++);
 await writeFile(recordPath(directory,args.operationId),'', {flag:'wx',mode:0o600});
 await assert.rejects(invoke({executor}),{code:'OPERATION_UNKNOWN'});assert.equal(calls,0);
 await invoke({operationId:'completed'});const file=recordPath(directory,'completed');const record=JSON.parse(await readFile(file,'utf8'));record.result.outputs.s1.changed=true;await writeFile(file,JSON.stringify(record));
 await assert.rejects(invoke({operationId:'completed',executor}),{code:'OPERATION_UNKNOWN'});assert.equal(calls,0);
});
