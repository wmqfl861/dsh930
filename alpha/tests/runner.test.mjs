import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadTeam,copy} from '../core.mjs';
import {AlphaRunner,RunStore} from '../runner.mjs';
import {fixtureConfig,fixtureExecutor,fixtureResponse} from '../fixtures.mjs';
const loaded=await loadTeam();
const brief={goal:'Build a reusable research team',acceptance:['Evidence can be traced']};
async function setup(t,executor=fixtureExecutor(),limits={}){
 const dir=await mkdtemp(join(tmpdir(),'alpha-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const data={...loaded,team:copy(loaded.team)};Object.assign(data.team.limits,limits);
 const store=new RunStore(dir);const runner=new AlphaRunner({...data,config:fixtureConfig(data.team),executor,store});
 return {runner,store,dir};
}
test('all seven main/shadow pairs complete a deterministic run, never live acceptance',async t=>{
 const {runner,store}=await setup(t);const result=await runner.run(brief);
 assert.equal(result.status,'fixture_complete');assert.equal(result.mode,'fixture');assert.equal(Object.keys(result.pairs).length,7);assert.equal(result.delegationsReserved,21);
 const disk=JSON.parse(await readFile(store.file,'utf8'));assert.deepEqual(disk,result);assert.equal((await stat(store.file)).mode&0o777,0o600);
});
test('shadow preparation actually overlaps the main and cannot see its draft',async t=>{
 let mainStarted;const mainGate=new Promise(r=>mainStarted=r);let shadowStarted=false;
 const executor=fixtureExecutor(async call=>{
  if(call.role.id!=='research')return;
  if(call.phase==='prepare'){shadowStarted=true;assert.ok(!('draft'in call.input));assert.ok(!('previous'in call.input));await mainGate;}
  if(call.phase==='draft'){assert.ok(shadowStarted);mainStarted();}
 });
 const {runner}=await setup(t,executor);await runner.run(brief);
 const e=runner.state.events;const ps=e.findIndex(x=>x.role==='research'&&x.phase==='prepare'&&x.type==='actor-start');const ms=e.findIndex(x=>x.role==='research'&&x.phase==='draft'&&x.type==='actor-start');const pe=e.findIndex(x=>x.role==='research'&&x.phase==='prepare'&&x.type==='actor-end');assert.ok(ps<ms&&ms<pe);
});
test('review receives both preparation and the exact submitted draft',async t=>{
 const {runner}=await setup(t,fixtureExecutor(async call=>{if(call.phase==='review'){assert.ok(call.input.preparation.checks.length);assert.ok(call.input.draft.artifact);assert.equal(call.model.id,'fixture-b');}}));await runner.run(brief);
});
test('upstream handoff waits for review, not merely primary completion',async t=>{
 const {runner}=await setup(t);await runner.run(brief);
 const e=runner.state.events;assert.ok(e.findIndex(x=>x.type==='pair-reviewed'&&x.role==='research')<e.findIndex(x=>x.type==='pair-start'&&x.role==='architect'));
});
test('a complete batch is reserved before either main or shadow starts',async t=>{
 let invoked=0;const {runner}=await setup(t,fixtureExecutor(()=>{invoked++;}),{maxDelegations:2});
 await assert.rejects(runner.run(brief),{code:'DELEGATION_BUDGET'});assert.equal(invoked,0);assert.equal(runner.state.status,'blocked');
});
test('a defect is revised and re-reviewed using a new artifact hash',async t=>{
 const executor=fixtureExecutor();const original=executor.execute;
 executor.execute=async call=>{
  const v=await original(call);
  if(call.role.id==='research'&&call.phase==='review'&&!call.input.draft.artifact.repaired){v.verdict='revise';v.findings=[{severity:'blocker',target:'source',reason:'missing comparison',evidence:'fixture defect',check:'add comparison'}];}
  if(call.role.id==='research'&&call.phase==='revise')v.artifact.repaired=true;
  return v;
 };
 const {runner}=await setup(t,executor);const result=await runner.run(brief);assert.equal(result.pairs.research.round,1);assert.equal(result.delegationsReserved,23);
 const r=result.events.filter(x=>x.type==='pair-reviewed'&&x.role==='research');assert.notEqual(r[0].subjectHash,r[1].subjectHash);
});
test('exhausting revision count never means success',async t=>{
 const executor=fixtureExecutor();executor.execute=async call=>{
  const v=fixtureResponse(call);if(call.phase==='review'){v.verdict='revise';v.findings=[{severity:'risk',target:'x',reason:'x',evidence:'x',check:'x'}];}return v;
 };
 const {runner}=await setup(t,executor);await assert.rejects(runner.run(brief),{code:'REVIEW_NOT_PASSED'});assert.equal(runner.state.status,'blocked');
});
test('shadow failure cancels the concurrent primary and waits for its cleanup',async t=>{
 let primaryStopped=false;
 const executor={mode:'fixture',async execute(call){
  if(call.phase==='prepare'){await new Promise(r=>setTimeout(r,30));throw new Error('shadow unavailable');}
  await new Promise((_,reject)=>{const stop=()=>{primaryStopped=true;reject(call.signal.reason);};call.signal.addEventListener('abort',stop,{once:true});if(call.signal.aborted)stop();});
 }};
 const {runner}=await setup(t,executor);await assert.rejects(runner.run(brief),/shadow unavailable/);assert.ok(primaryStopped);assert.equal(runner.busy,false);
});
test('already aborted run starts no model delegation',async t=>{
 let calls=0;const {runner}=await setup(t,fixtureExecutor(()=>calls++));const ctl=new AbortController();ctl.abort();await assert.rejects(runner.run(brief,ctl.signal));assert.equal(calls,0);
});
test('configured pair timeout stops cooperative delegates',async t=>{
 const executor={mode:'fixture',execute:call=>new Promise((_,reject)=>{const stop=()=>reject(call.signal.reason);call.signal.addEventListener('abort',stop,{once:true});if(call.signal.aborted)stop();})};
 const {runner}=await setup(t,executor,{pairTimeoutMs:30});const keepAlive=setInterval(()=>{},50);try{await assert.rejects(runner.run(brief));}finally{clearInterval(keepAlive);}assert.equal(runner.state.status,'blocked');
});
test('unknown candidate model is rejected after assembly',async t=>{
 const executor=fixtureExecutor();executor.execute=async call=>{const v=fixtureResponse(call);if(call.role.id==='integrator'&&call.phase==='draft')v.artifact.members[0].modelRef='invented-model';return v;};
 const {runner}=await setup(t,executor);await assert.rejects(runner.run(brief),{code:'CANDIDATE_MODEL'});
});
test('unresolved integration gaps cannot be hidden by a positive review',async t=>{
 const executor=fixtureExecutor();executor.execute=async call=>{const v=fixtureResponse(call);if(call.role.id==='integrator'&&call.phase==='draft')v.artifact.gaps=['no executable sandbox'];return v;};
 const {runner}=await setup(t,executor);await assert.rejects(runner.run(brief),{code:'CANDIDATE_GAPS'});
});
test('end-to-end verdict must reference the exact integrated version',async t=>{
 const executor=fixtureExecutor();executor.execute=async call=>{const v=fixtureResponse(call);if(call.role.id==='evaluator'&&call.phase==='draft')v.artifact.acceptedCandidateHash='old';return v;};
 const {runner}=await setup(t,executor);await assert.rejects(runner.run(brief),{code:'ACCEPTANCE_SUBJECT'});
});
test('running with a live adapter still ends at human acceptance, never auto release',async t=>{
 const executor=fixtureExecutor();executor.mode='dsh';const {runner}=await setup(t,executor);const result=await runner.run(brief);assert.equal(result.status,'awaiting_human_acceptance');
});
test('model and requirements mutations outside a run cannot change the captured configuration',async t=>{
 const {runner}=await setup(t);const b=copy(brief);const promise=runner.run(b);b.goal='changed';const result=await promise;assert.equal(result.brief.goal,brief.goal);
});
