/** Real supported DSH profiles with deterministic providers; no live model or network acceptance. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTeam,digest} from '../core.mjs';
import {fixtureConfig} from '../fixtures.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const tmp=await mkdtemp(join(tmpdir(),'dsh-alpha-native-'));
const reports=[];let allLogs='';
function verifyResearch(state){
 assert.equal(state.status,'research_reviewed');assert.equal(state.executionScope,'research-pair');assert.equal(state.qualityAcceptanceGranted,false);
 assert.deepEqual(Object.keys(state.pairs),['research']);assert.equal(state.delegationsReserved,3);
 assert.equal(state.events.find(e=>e.type==='run-start').logicalActors,2);assert.equal(Object.hasOwn(state,'candidateHash'),false);
 const pair=state.pairs.research;assert.equal(pair.status,'reviewed');assert.equal(pair.subjectHash,digest(pair.draft));assert.equal(pair.review.subjectHash,pair.subjectHash);
 const host=[pair.prep._host,pair.draft._host,pair.review._host];assert.equal(new Set(host.map(h=>h.childId)).size,3);assert.ok(host.every(h=>typeof h.childId==='string'&&h.childId.length));
 const callIds=[];
 for(const [phase,output]of [['prepare',pair.prep],['draft',pair.draft]]){
  const receipts=output._host.toolReceipts.filter(r=>r.tool==='web_fetch'&&!r.isError);
  assert.equal(receipts.length,1);assert.equal(receipts[0].url,`https://fixture.invalid/alpha-method/research/${phase}`);
  assert.match(receipts[0].contentHash,/^[a-f0-9]{64}$/);assert.ok(output.sources.some(s=>s.url===receipts[0].url));callIds.push(receipts[0].callId);
 }
 assert.equal(new Set(callIds).size,2);
 const starts=state.events.filter(e=>e.type==='actor-start');assert.deepEqual(starts.map(e=>[e.actor,e.phase]),[['research-shadow','prepare'],['research','draft'],['research-shadow','review']]);
 const firstEnd=state.events.findIndex(e=>e.type==='actor-end');assert.ok(state.events.findIndex(e=>e.type==='actor-start'&&e.phase==='draft')<firstEnd);
}
try{
 for(const scenario of ['team','research','cancel','failure','liveoff','borrowed']){
  const home=join(tmp,scenario),conf=join(tmp,scenario+'-models.json'),patch=join(tmp,scenario+'-overlay.json'),runs=join(tmp,scenario+'-runs');
  const {team}=await loadTeam();const config=fixtureConfig(team);if(scenario==='liveoff')config.liveEnabled=false;
  await writeFile(conf,JSON.stringify(config));await writeFile(patch,JSON.stringify([
   {id:'llm-deepseek',disabled:true},{id:'llm-deepseek-account',disabled:true},{id:'web-search-deepseek',disabled:true},
   {insert:[{id:'alpha-native-fixture',name:join(root,'alpha/tests/native-fixture.mjs')},{id:'alpha-team',name:join(root,'alpha/dsh-plugin.mjs'),config:{modelConfigPath:conf,stateDirectory:runs}}]},
  ]));
  const env={...process.env,DSH_HOME:home,DSH_AGENTS_HOME:join(home,'agents'),DSH_TELEMETRY_DISABLED:'1',DSH_TOOLS_MODE:'native',ALPHA_NATIVE_CASE:scenario};
  for(const k of Object.keys(env))if(/KEY|PASSWORD|SECRET|TOKEN/i.test(k))delete env[k];
  const child=spawn(process.execPath,['--import','tsx/esm','apps/cli/src/bin.ts','--profile','headless','--patch',patch,'Run the Alpha native fixture'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b.toString()).slice(-2000000);});
  const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timer));
  allLogs+=`\nCASE ${scenario}\n${log}`;
  assert.equal(result.code,0,`${scenario}: ${log.slice(-10000)}`);assert.equal(result.signal,null);assert.match(log,/ALPHA_NATIVE_FIXTURE_OK/);
  const names=await readdir(runs).catch(error=>{if(scenario==='liveoff'&&error.code==='ENOENT')return [];throw error;});
  assert.equal(names.some(f=>f.endsWith('.lock')),false);
  const states=await Promise.all(names.filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(join(runs,f),'utf8'))));
  if(scenario==='team'){
   assert.equal(states.length,1);assert.equal(Object.keys(states[0].pairs).length,7);assert.equal(states[0].delegationsReserved,21);assert.equal(states[0].status,'awaiting_human_acceptance');
  }else if(scenario==='liveoff')assert.equal(states.length,0);
  else{
   const success=states.filter(s=>s.status==='research_reviewed');assert.equal(success.length,1);verifyResearch(success[0]);
   assert.equal(states.length,scenario==='research'?1:2);
   if(scenario!=='research'){const stopped=states.find(s=>s!==success[0]);assert.equal(stopped.status,scenario==='cancel'?'cancelled':'blocked');assert.equal(stopped.qualityAcceptanceGranted,false);assert.equal(stopped.executionScope,'research-pair');assert.ok(!stopped.events.some(e=>e.type==='run-end'));}
  }
  const researchEvidence=scenario==='research'?states[0].pairs.research:undefined;
  reports.push({scenario,status:'passed',runCount:states.length,logicalActors:scenario==='team'?14:scenario==='liveoff'?0:2,delegationsPerSuccessfulRun:scenario==='team'?21:scenario==='liveoff'?0:3,
   ...(researchEvidence?{researchEvidence:{subjectHash:researchEvidence.subjectHash,reviewSubjectHash:researchEvidence.review.subjectHash,
    children:[researchEvidence.prep,researchEvidence.draft,researchEvidence.review].map(output=>output._host)}}:{})});
 }
 console.log(JSON.stringify({nativeDshLifecycle:'passed',provider:'deterministic-fixture',scenarios:reports,paidModelCalls:0,realModelQualityEvaluated:false}));
}finally{
 await writeFile(process.env.ALPHA_NATIVE_LOG??join(tmpdir(),'alpha-native-smoke.log'),allLogs);
 await rm(tmp,{recursive:true,force:true});
}
