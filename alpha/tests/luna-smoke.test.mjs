import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureLuna,probeLuna} from '../luna-smoke.mjs';
import {loadTeam,preflight,copy} from '../core.mjs';
import {AlphaRunner,RunStore} from '../runner.mjs';
import {fixtureResponse} from '../fixtures.mjs';
const settings={baseURL:'https://gateway.example/v1',model:'gpt-6-luna',reasoningEffort:'max',stream:true,api:'openai-responses'};
async function temp(t){const d=await mkdtemp(join(tmpdir(),'alpha-luna-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('all fourteen actors bind the requested Luna model and max effort; normal mode still rejects same-model pairs',async t=>{
 const s=await configureLuna(join(await temp(t),'private'),settings);const {team}=await loadTeam();
 assert.equal(Object.values(s.config.bindings).length,7);assert.equal(s.config.models[0].model,settings.model);assert.equal(preflight(team,s.config).ready,true);
 const normal=copy(s.config);delete normal.executionPurpose;assert.ok(preflight(team,normal).issues.some(i=>i.startsWith('SAME_MODEL_PAIR:')));
 const bad=copy(s.config);bad.acknowledgeNoIndependentReview=false;assert.ok(preflight(team,bad).issues.includes('SMOKE_ACK_REQUIRED'));
 const text=await readFile(s.overlayPath,'utf8');assert.ok(text.includes('ALPHA_SMOKE_API_KEY'));assert.ok(!text.includes('Bearer '));
});
test('plain HTTP is refused, including the obsolete acknowledgement',async t=>{await assert.rejects(configureLuna(join(await temp(t),'private'),{...settings,baseURL:'http://gateway.example/v1'}),/HTTPS_V1_REQUIRED/);});
test('401 without a secret establishes HTTP reachability but performs no inference',async()=>{
 const r=await probeLuna(settings,undefined,{fetchImpl:async(_url,options)=>{assert.equal(options.headers.Authorization,undefined);return new Response('',{status:401});}});
 assert.equal(r.status,'credential_required');assert.equal(r.requests[0].httpStatus,401);assert.equal(r.inferenceRequests,0);assert.equal(r.teamRun,false);
});
test('connection rejection is not reported as model failure and never exposes the key',async()=>{
 const r=await probeLuna(settings,'TEST_ONLY_SECRET',{fetchImpl:async()=>{throw new Error('TEST_ONLY_SECRET',{cause:{code:'ECONNREFUSED'}});}});
 assert.equal(r.status,'transport_blocked');assert.equal(r.error,'ECONNREFUSED');assert.ok(!JSON.stringify(r).includes('TEST_ONLY_SECRET'));
});
test('gateway errors stop without retries or raw provider logging',async()=>{
 let calls=0;const r=await probeLuna(settings,'TEST_ONLY_SECRET',{fetchImpl:async()=>new Response('',{status:(calls++,403)})});
 assert.equal(calls,1);assert.equal(r.error,'HTTP_403');assert.equal(r.inferenceRequests,1);
});
test('all seven pairs and 21 delegations execute using one route with fixture labeling',async t=>{
 const d=await temp(t);const setup=await configureLuna(join(d,'private'),settings);const loaded=await loadTeam();const seen=[];
 const executor={mode:'fixture',async execute(call){seen.push(call.actor);if(call.phase==='prepare')assert.equal(call.input.draft,undefined);const v=fixtureResponse(call);if(call.role.id==='integrator'&&call.phase==='draft')v.artifact.members[0].modelRef='luna-smoke';return v;}};
 const runner=new AlphaRunner({...loaded,config:setup.config,executor,store:new RunStore(join(d,'runs'))});
 const state=await runner.run({goal:'Test route and orchestration only',acceptance:['No quality claim']});
 assert.equal(seen.length,21);assert.equal(new Set(seen).size,14);assert.equal(state.status,'fixture_complete');assert.equal(state.qualityAcceptanceGranted,false);assert.equal(runner.team.limits.maxRepairRounds,0);
});
