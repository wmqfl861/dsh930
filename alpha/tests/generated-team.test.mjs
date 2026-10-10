import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadTeam,copy,digest} from '../core.mjs';
import {compileGeneratedTeam,runGeneratedTeam} from '../generated-team.mjs';
import {RunStore} from '../runner.mjs';
import {fixtureConfig,fixtureExecutor,fixtureResponse} from '../fixtures.mjs';
const loaded=await loadTeam();
function blueprint(count=2) {
 return {objective:'Compare supplied requirements',members:Array.from({length:count},(_,i)=>({id:'specialist-'+i,modelRef:'fixture-a',shadowModelRef:'fixture-b',responsibility:'Inspect requirement '+i,skills:['alpha-evidence'],tools:[]})),steps:Array.from({length:count},(_,i)=>({id:'task-'+i,owner:'specialist-'+i,dependsOn:i?['task-'+(i-1)]:[],input:'prior reviewed findings',output:'assessment',check:'Compare explicit requirements',onFailure:'stop'})),gaps:[],acceptance:['All requirements examined']};
}
function options(candidate=blueprint()) {return {operationId:randomUUID(),...loaded,team:copy(loaded.team),config:fixtureConfig(loaded.team),candidate};}
async function run(t,opts,executor=fixtureExecutor(),signal) {
 const dir=await mkdtemp(join(tmpdir(),'alpha-generated-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new RunStore(dir);const result=await runGeneratedTeam({...opts,executor,store,signal});
 assert.deepEqual(JSON.parse(await readFile(store.file,'utf8')),result);
 return result;
}
for(const count of [1,3,8])test('executes '+count+' generated specialist pairs through the existing runtime',async t=>{
 const o=options(blueprint(count)); const calls=[];
 const result=await run(t,o,fixtureExecutor(call=>{
  calls.push(call);
  assert.ok(call.persona.includes(loaded.skills['alpha-evidence']));
  assert.ok(call.input.member.responsibility);
  assert.equal(call.input.step.id,'task-'+call.role.id.split(':').at(-1));
  if(call.phase==='prepare')assert.equal(call.input.draft,undefined);
  if(call.phase==='review'){assert.equal(call.model.id,'fixture-b');assert.equal(call.input.subjectHash,digest(call.input.draft));}
 }));
 assert.equal(result.executionScope,'generated-team');assert.equal(result.status,'fixture_complete');assert.equal(result.qualityAcceptanceGranted,false);
 assert.equal(result.team.logicalActors,count*2);assert.equal(result.delegationsReserved,count*3);assert.equal(Object.keys(result.outputs).length,count);assert.equal(calls.length,count*3);
 for(let i=1;i<count;i++){
  const start=result.events.findIndex(e=>e.type==='pair-start'&&e.role==='step:'+i);
  const review=result.events.findIndex(e=>e.type==='pair-reviewed'&&e.role==='step:'+(i-1));
  assert.ok(start>review);
  assert.ok(calls.find(c=>c.role.id==='step:'+i).input.upstream['task-'+(i-1)]);
 }
});
const invalid=[
 ['unknown dependency',c=>c.steps[0].dependsOn=['absent'],'CANDIDATE_DAG'],
 ['cycle',c=>c.steps[0].dependsOn=['task-1'],'CANDIDATE_DAG'],
 ['null member',c=>c.members[0]=null,'CANDIDATE_MEMBER'],
 ['null step',c=>c.steps[0]=null,'CANDIDATE_STEP'],
 ['unbound shadow',c=>c.members[0].shadowModelRef='missing','PREFLIGHT'],
 ['same model',c=>c.members[0].shadowModelRef='fixture-a','PREFLIGHT'],
 ['missing shadow',c=>delete c.members[0].shadowModelRef,'BLUEPRINT_REVIEWER'],
 ['unknown skill',c=>c.members[0].skills=['invented'],'BLUEPRINT_SKILL'],
 ['forbidden tool',c=>c.members[0].tools=['shell'],'BLUEPRINT_TOOL'],
 ['gaps',c=>c.gaps=['No tool'],'CANDIDATE_GAPS'],
 ['unsupported recovery',c=>c.steps[0].onFailure='retry forever','BLUEPRINT_FAILURE_POLICY'],
 ['empty acceptance',c=>c.acceptance=[''],'CANDIDATE_GATES'],
 ['unused member',c=>c.steps[1].owner=c.members[0].id,'BLUEPRINT_UNUSED_MEMBER'],
];
for(const [name,change,code] of invalid)test('rejects '+name+' before any executor preflight or child call',async()=>{
 const o=options();change(o.candidate);let calls=0;
 await assert.rejects(runGeneratedTeam({...o,executor:{mode:'fixture',preflight(){calls++;},execute(){calls++;}}}),{code});assert.equal(calls,0);
});
test('operator budgets, modes and model alias independence cannot be overridden',()=>{
 const o=options();o.team.limits.maxDelegations=5;assert.throws(()=>compileGeneratedTeam(o),{code:'DELEGATION_BUDGET'});
 o.team.limits.maxDelegations=30;o.config.executionPurpose='single-model-smoke';assert.throws(()=>compileGeneratedTeam(o),{code:'GENERATED_REVIEW'});
 delete o.config.executionPurpose;o.config.models[1].canonicalModelId=o.config.models[0].canonicalModelId;assert.throws(()=>compileGeneratedTeam(o),{code:'PREFLIGHT'});
});
test('reserved and fixed-workflow step names remain ordinary generated tasks',async t=>{
 const o=options();o.candidate.steps[0].id='__proto__';o.candidate.steps[1].id='evaluator';o.candidate.steps[1].dependsOn=['__proto__'];
 const result=await run(t,o);assert.ok(Object.hasOwn(result.outputs,'__proto__'));assert.ok(Object.hasOwn(result.outputs,'evaluator'));
});
test('web-capable generated roles retain source-fetch requirements without role-name heuristics',()=>{
 const o=options();o.candidate.members[0].tools=['web_fetch'];assert.equal(compileGeneratedTeam(o).team.roles[0].requiresFetchedSources,true);
});
test('caller mutation cannot change captured plan or model bindings',async t=>{
 const o=options();const goal=o.candidate.objective;
 const result=await run(t,o,fixtureExecutor(()=>{o.candidate.objective='changed';o.candidate.steps[1].dependsOn=[];o.config.models[0].model='changed';}));
 assert.equal(result.brief.goal,goal);assert.deepEqual(result.team.roles[1].dependsOn,['step:0']);
});
test('parallel failure cancels siblings, drains cleanup, and never starts dependents',async t=>{
 const o=options(blueprint(3));o.team.limits.maxConcurrentPairs=2;o.candidate.steps[1].dependsOn=[];o.candidate.steps[2].dependsOn=['task-0','task-1'];
 let started=0,release;const ready=new Promise(r=>release=r);let stopped=0;const seen=[];
 const executor={mode:'fixture',async execute(call){
  seen.push(call.role.id);if(++started===4)release();await ready;
  if(call.role.id==='step:0'&&call.phase==='prepare')throw new Error('independent shadow failed');
  await new Promise((_,reject)=>{const stop=()=>{stopped++;reject(call.signal.reason);};call.signal.addEventListener('abort',stop,{once:true});if(call.signal.aborted)stop();});
 }};
 await assert.rejects(run(t,o,executor),/independent shadow failed/);assert.equal(stopped,3);assert.equal(seen.includes('step:2'),false);
});
test('external cancellation drains the active pair before reporting cancelled on disk',async t=>{
 const o=options();const ctl=new AbortController();let calls=0,stopped=0;
 const dir=await mkdtemp(join(tmpdir(),'alpha-cancel-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new RunStore(dir);
 const executor={mode:'fixture',async execute(call){
  const pending=new Promise((_,reject)=>{const stop=()=>{stopped++;reject(call.signal.reason);};call.signal.addEventListener('abort',stop,{once:true});if(call.signal.aborted)stop();});
  if(++calls===2)ctl.abort(new Error('user cancelled'));await pending;
 }};
 await assert.rejects(runGeneratedTeam({...o,executor,store,signal:ctl.signal}),/user cancelled/);
 assert.equal(stopped,2);assert.equal(calls,2);assert.equal(JSON.parse(await readFile(store.file,'utf8')).status,'cancelled');
});
test('failed or stale independent review cannot release a dependent task',async t=>{
 for(const stale of [false,true]){
  const o=options();o.team.limits.maxRepairRounds=0;const seen=[];const executor=fixtureExecutor();
  executor.execute=async call=>{seen.push(call.role.id);const v=fixtureResponse(call);if(call.phase==='review'){if(stale)v.subjectHash='stale';else {v.verdict='blocked';v.findings=[{severity:'blocker',target:'output',reason:'incomplete',evidence:'missing requirement',check:'inspect requirement'}];}}return v;};
  await assert.rejects(run(t,o,executor),{code:stale?'STALE_REVIEW':'REVIEW_NOT_PASSED'});assert.ok(seen.every(id=>id==='step:0'));
 }
});
test('the team builder output executes independently through the generated entry',async t=>{
 const {AlphaRunner}=await import('../runner.mjs');
 const o=options();const dir=await mkdtemp(join(tmpdir(),'alpha-build-execute-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const built=await new AlphaRunner({...loaded,config:o.config,executor:fixtureExecutor(),store:new RunStore(dir)}).run({goal:'Generate a team',acceptance:['Trace output']});
 const result=await run(t,options(built.pairs.integrator.draft.artifact));
 assert.equal(result.delegationsReserved,3);assert.deepEqual(Object.keys(result.outputs),['s1']);
});
test('generated template-looking text stays literal task data outside the DSH persona template',async t=>{
 const o=options(blueprint(1));o.candidate.steps[0].id='{{step}}';o.candidate.steps[0].input='Analyze {{customer_name}}';o.candidate.members[0].responsibility='Retain {{original}}';o.candidate.members[0].id='{{member}}';o.candidate.steps[0].owner='{{member}}';
 await run(t,o,fixtureExecutor(call=>{
  assert.ok(!call.persona.includes('{{'));assert.equal(call.input.step.id,'{{step}}');assert.equal(call.input.step.input,'Analyze {{customer_name}}');assert.equal(call.input.member.responsibility,'Retain {{original}}');
 }));
});
test('same-model trial is host opt-in, single-route and never independent acceptance',async t=>{
 const o=options(blueprint(1));o.config.executionPurpose='single-model-team-trial';o.config.models=[o.config.models[0]];o.candidate.members[0].shadowModelRef='fixture-a';
 assert.throws(()=>compileGeneratedTeam(o),/TEAM_TRIAL_ACK_REQUIRED/);
 o.config.acknowledgeNoIndependentReview=true;
 const result=await run(t,o);assert.equal(result.independentReviewConfigured,false);assert.equal(result.qualityAcceptanceGranted,false);assert.equal(result.executionPurpose,'single-model-team-trial');assert.equal(result.delegationsReserved,3);
 o.config.models.push({...o.config.models[0],id:'alias'});assert.throws(()=>compileGeneratedTeam(o),/TEAM_TRIAL_SINGLE_ROUTE_REQUIRED/);
});

test('same-model trial scope cannot be expanded through the public compiler',()=>{
 const o=options(blueprint(2));o.config.executionPurpose='single-model-team-trial';o.config.acknowledgeNoIndependentReview=true;
 assert.throws(()=>compileGeneratedTeam(o),{code:'TEAM_TRIAL_SCOPE_REQUIRED'});
 o.candidate=blueprint(1);o.candidate.members[0].tools=['web_fetch'];assert.throws(()=>compileGeneratedTeam(o),{code:'TEAM_TRIAL_SCOPE_REQUIRED'});
});

test('candidate cannot self-authorize a same-model trial',()=>{
 const o=options(blueprint(1));o.candidate.members[0].shadowModelRef='fixture-a';o.candidate.executionPurpose='single-model-team-trial';o.candidate.acknowledgeNoIndependentReview=true;
 assert.throws(()=>compileGeneratedTeam(o),/SAME_MODEL_PAIR/);
});
