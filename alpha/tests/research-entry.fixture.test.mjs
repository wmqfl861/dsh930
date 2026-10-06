import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runResearchPair} from '../research-entry.mjs';
import {loadTeam,digest,copy} from '../core.mjs';
import {AlphaRunner,RunStore} from '../runner.mjs';
import {fixtureConfig,fixtureExecutor,fixtureResponse} from '../fixtures.mjs';
const loaded=await loadTeam();
const brief={goal:'Research one bounded topic',acceptance:['Review the exact draft']};
async function setup(t,executor=fixtureExecutor()) {
 const directory=await mkdtemp(join(tmpdir(),'alpha-research-entry-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new RunStore(directory);
 return {args:{...loaded,config:fixtureConfig(loaded.team),executor,store,brief},store,directory};
}
async function persisted(store){return JSON.parse(await readFile(store.file,'utf8'));}
async function noLock(directory){assert.equal((await readdir(directory)).some(name=>name.endsWith('.lock')),false);}

test('research entry completes exactly one reviewed fixture pair and preserves its inputs',async t=>{
 const calls=[];let releaseMain;const mainStarted=new Promise(resolve=>releaseMain=resolve);
 const executor=fixtureExecutor(async call=>{
  calls.push(call);
  if(call.phase==='prepare'){assert.equal(Object.hasOwn(call.input,'draft'),false);await mainStarted;}
  if(call.phase==='draft')releaseMain();
  if(call.phase==='review'){assert.equal(call.input.subjectHash,digest(call.input.draft));assert.ok(call.input.preparation.checks.length);}
 });
 const {args,store,directory}=await setup(t,executor);const original=copy(args.team),config=copy(args.config);
 const result=await runResearchPair(args);
 assert.equal(result.status,'fixture_complete');assert.equal(result.executionScope,'research-pair');
 assert.equal(result.qualityAcceptanceGranted,false);assert.deepEqual(Object.keys(result.pairs),['research']);
 assert.equal(result.pairs.research.status,'reviewed');assert.equal(result.delegationsReserved,3);
 assert.equal(Object.hasOwn(result,'candidateHash'),false);
 assert.deepEqual(calls.map(c=>[c.actor,c.phase]),[['research-shadow','prepare'],['research','draft'],['research-shadow','review']]);
 assert.ok(calls.every(c=>c.role.id==='research'&&Object.keys(c.input.upstream).length===0));
 assert.equal(result.events.find(e=>e.type==='run-start').logicalActors,2);
 assert.equal(result.events.at(-1).type,'run-end');assert.deepEqual(await persisted(store),result);
 assert.deepEqual(args.team,original);assert.deepEqual(args.config,config);await noLock(directory);
});

test('research DSH-mode executor returns review completion without team or quality acceptance',async t=>{
 const executor=fixtureExecutor();executor.mode='dsh';
 let checked=false;executor.preflight=async team=>{checked=true;assert.deepEqual(team.roles.map(r=>r.id),['research']);};
 const {args}=await setup(t,executor);const result=await runResearchPair(args);
 assert.equal(checked,true);assert.equal(result.status,'research_reviewed');assert.equal(result.qualityAcceptanceGranted,false);
 assert.equal(Object.hasOwn(result,'candidateHash'),false);
});

test('research entry preserves live-disabled rejection before creating a run or invoking executor',async t=>{
 let calls=0;const {args,store,directory}=await setup(t,fixtureExecutor(()=>calls++));args.config.liveEnabled=false;
 await assert.rejects(runResearchPair(args),{code:'PREFLIGHT',message:'LIVE_DISABLED'});
 assert.equal(calls,0);assert.equal(store.file,undefined);assert.deepEqual(await readdir(directory),[]);
});

test('already cancelled research entry invokes no executor and creates no run',async t=>{
 let calls=0;const {args,store}=await setup(t,fixtureExecutor(()=>calls++));
 const controller=new AbortController();const reason=new Error('caller cancelled before start');controller.abort(reason);
 await assert.rejects(runResearchPair({...args,signal:controller.signal}),error=>error===reason);
 assert.equal(calls,0);assert.equal(store.file,undefined);
});

test('research cancellation interrupts both active delegates and closes the journal',async t=>{
 const controller=new AbortController();const reason=new Error('caller cancelled active research');let started=0,stopped=0;
 const executor=fixtureExecutor(async call=>{
  if(++started===2)queueMicrotask(()=>controller.abort(reason));
  await new Promise((resolve,reject)=>{call.signal.addEventListener('abort',()=>{stopped++;reject(call.signal.reason);},{once:true});});
 });
 const {args,store,directory}=await setup(t,executor);
 await assert.rejects(runResearchPair({...args,signal:controller.signal}),error=>error===reason);
 assert.equal(started,2);assert.equal(stopped,2);const state=await persisted(store);
 assert.equal(state.status,'cancelled');assert.equal(state.executionScope,'research-pair');await noLock(directory);
});

test('research shadow failure cancels its sibling and never reaches review or acceptance',async t=>{
 const failure=new Error('fixture shadow failed');let mainStarted,stopped=false,reviews=0;
 const gate=new Promise(resolve=>mainStarted=resolve);
 const executor=fixtureExecutor(async call=>{
  if(call.phase==='prepare'){await gate;throw failure;}
  if(call.phase==='review'){reviews++;return;}
  mainStarted();await new Promise((resolve,reject)=>{call.signal.addEventListener('abort',()=>{stopped=true;reject(call.signal.reason);},{once:true});});
 });
 const {args,store,directory}=await setup(t,executor);
 await assert.rejects(runResearchPair(args),error=>error===failure);
 const state=await persisted(store);assert.equal(stopped,true);assert.equal(reviews,0);assert.equal(state.status,'blocked');
 assert.equal(state.qualityAcceptanceGranted,false);await noLock(directory);
});

test('research review remains bound to the submitted draft hash',async t=>{
 const executor=fixtureExecutor();executor.execute=async call=>{const output=fixtureResponse(call);if(call.phase==='review')output.subjectHash='wrong-version';return output;};
 const {args,store,directory}=await setup(t,executor);
 await assert.rejects(runResearchPair(args),{code:'STALE_REVIEW'});assert.equal((await persisted(store)).status,'blocked');await noLock(directory);
});

test('research scope rejects a missing research role and unknown scopes',()=>{
 const args={...loaded,config:fixtureConfig(loaded.team),executor:fixtureExecutor(),store:{}};
 assert.throws(()=>new AlphaRunner({...args,executionScope:'unknown'}),{code:'EXECUTION_SCOPE'});
 assert.throws(()=>new AlphaRunner({...args,team:{...loaded.team,roles:[]},executionScope:'research-pair'}),{code:'RESEARCH_ROLE'});
});

function singleModelConfig(purpose){
 const config=fixtureConfig(loaded.team);config.models=config.models.slice(0,1);
 for(const id of Object.keys(config.bindings))config.bindings[id]={primary:config.models[0].id,shadow:config.models[0].id};
 return {...config,executionPurpose:purpose,acknowledgeNoIndependentReview:true};
}
test('explicit single-model research runs actual research scope with honest non-independent labeling',async t=>{
 const inputs=[];const {args}=await setup(t,fixtureExecutor(call=>inputs.push(call.input)));args.config=singleModelConfig('single-model-research');
 const result=await runResearchPair(args);assert.equal(result.executionPurpose,'single-model-research');assert.equal(result.independentReviewConfigured,false);
 assert.equal(result.qualityAcceptanceGranted,false);assert.equal(result.delegationsReserved,3);assert.equal(inputs.length,3);
 for(const input of inputs){assert.match(input.testScope,/Real single-model exploratory research/);assert.doesNotMatch(input.testScope,/connectivity smoke only/);}
});
test('single-model research requires an explicit same-model acknowledgement',async t=>{
 const {args}=await setup(t);args.config=singleModelConfig('single-model-research');delete args.config.acknowledgeNoIndependentReview;
 await assert.rejects(runResearchPair(args),{code:'PREFLIGHT',message:'RESEARCH_ACK_REQUIRED'});
});
test('single-model research rejects full-team execution before any delegation',async t=>{
 let calls=0;const {args}=await setup(t,fixtureExecutor(()=>calls++));args.config=singleModelConfig('single-model-research');
 await assert.rejects(new AlphaRunner(args).run(brief),{code:'RESEARCH_SCOPE_REQUIRED'});assert.equal(calls,0);
});
test('single-model research refuses implicit extra routes and automatic repair',async t=>{
 const {args,store}=await setup(t);args.config=singleModelConfig('single-model-research');args.config.models.push({...args.config.models[0],id:'other'});
 await assert.rejects(runResearchPair(args),{code:'PREFLIGHT',message:'RESEARCH_SINGLE_ROUTE_REQUIRED'});
 args.config=singleModelConfig('single-model-research');let calls=0;args.executor=fixtureExecutor();
 args.executor.execute=async call=>{calls++;const output=fixtureResponse(call);if(call.phase==='review'){output.verdict='revise';output.findings=[{severity:'risk',target:'draft',reason:'fixture defect',evidence:'fixture',check:'operator review'}];}return output;};
 await assert.rejects(runResearchPair(args),{code:'REVIEW_NOT_PASSED'});assert.equal(calls,3);assert.equal((await persisted(store)).status,'blocked');
});
test('existing same-model smoke retains its diagnostic label',async t=>{
 const inputs=[];const {args}=await setup(t,fixtureExecutor(call=>inputs.push(call.input)));args.config=singleModelConfig('single-model-smoke');
 const result=await runResearchPair(args);assert.equal(result.executionPurpose,'single-model-smoke');assert.equal(result.independentReviewConfigured,false);
 assert.ok(inputs.every(input=>input.testScope.includes('connectivity smoke only')));
});
