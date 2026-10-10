import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {runTeamTrial} from '../team-trial.mjs';
const settings=JSON.parse(await readFile(new URL('../luna.gateway.json',import.meta.url),'utf8'));
test('native same-model trial builds, executes and reviews in four fresh sessions without paid calls',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'alpha-team-trial-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const result=await runTeamTrial({directory,operationId:'native-trial',fixture:true,settings});
 assert.equal(result.status,'fixture_complete');assert.equal(result.process.code,0);assert.equal(result.paidModelCalls,0);
 assert.equal(new Set(result.children).size,4);assert.equal(result.qualityAcceptanceGranted,false);assert.equal(result.independentReviewConfigured,false);
 assert.equal(result.candidate.members.length,1);assert.equal(result.execution.delegationsReserved,3);
 assert.deepEqual(result.execution.outputs['write-checklist'].checklist,['Bring water','Confirm the address','Leave ten minutes early']);
 await assert.rejects(runTeamTrial({directory,operationId:'native-trial',fixture:true,settings}),{code:'EEXIST'});
});
test('rejects absent operation identity before setup or dispatch',async()=>{
 await assert.rejects(runTeamTrial({directory:'/not-used',fixture:true,settings}),/OPERATION_ID_REQUIRED/);
});
test('live guard permits four text-only requests, records actual usage and refuses retries and alternate destinations',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'alpha-trial-guard-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const config=join(directory,'config.json'),reportPath=join(directory,'usage.json');
 await writeFile(config,JSON.stringify({settings,reportPath}));
 const guard=new URL('../team-trial-guard.mjs',import.meta.url).href;
 const wire=new URL('../luna-responses.mjs',import.meta.url).href;
 const fixture=new URL('luna-sse-fixture.mjs',import.meta.url).href;
 const program=`import assert from 'node:assert/strict';import {fixtureSse} from ${JSON.stringify(fixture)};import {lunaRequest,userInput} from ${JSON.stringify(wire)};
 const incomplete=process.env.ALPHA_TRIAL_TEST_INCOMPLETE==='1';
 let calls=0;globalThis.fetch=async()=>{calls++;if(incomplete&&calls===4)return new Response('data: '+JSON.stringify({type:'response.incomplete',response:{usage:{input_tokens:12,output_tokens:7}}})+'\\n\\n',{headers:{'content-type':'text/event-stream'}});return fixtureSse([{id:'msg_test',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'test only',annotations:[]}]}]);};
 await import(${JSON.stringify(guard)});
 const settings=${JSON.stringify(settings)},body=lunaRequest(settings,userInput('test only'));
 const request=(url=settings.baseURL+'/responses',extra={})=>fetch(url,{method:'POST',body:JSON.stringify({...body,...extra})});
 await assert.rejects(request('https://not-authorized.invalid/v1/responses'));await assert.rejects(request(undefined,{tools:[{type:'function',name:'forbidden'}]}));
 await assert.rejects(request(undefined,{input:[{role:'user',content:[{type:'input_image',image_url:'https://example.invalid/image.png'}]}]}),/TRIAL_TEXT_ONLY/);
 await assert.rejects(request(undefined,{modalities:['audio']}),/TRIAL_TEXT_ONLY/);
 for(let i=0;i<4;i++){const response=await request();await response.text();}
 await assert.rejects(request(),/TRIAL_REQUEST_LIMIT/);assert.equal(calls,4);
 const guard=globalThis[Symbol.for('dsh.alpha.team-trial.guard')];await guard.flush();assert.equal(guard.verified(),!incomplete);`;
 const env={...process.env,ALPHA_TEAM_TRIAL_GUARD_CONFIG:config,ALPHA_TEAM_TRIAL_ALLOW_LIVE:'1',ALPHA_TEAM_TRIAL_COST_AUTHORIZATION:'uncapped'};
 for(const key of Object.keys(env))if(/KEY|PASSWORD|SECRET|TOKEN/i.test(key))delete env[key];
 for(const incomplete of [false,true]){
 const child=spawn(process.execPath,['--input-type=module','-e',program],{env:{...env,ALPHA_TRIAL_TEST_INCOMPLETE:incomplete?'1':'0'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});assert.equal(code,0,output);
 const report=JSON.parse(await readFile(reportPath,'utf8'));assert.equal(report.inferenceRequests,4);assert.equal(report.monetaryCostUsd,null);assert.equal(report.maxRetries,0);assert.equal(report.requests[0].usage.input_tokens,20);
 if(incomplete){assert.equal(report.requests[3].completed,false);assert.equal(report.requests[3].usage.output_tokens,7);}
 }
});
for(const scenario of ['complete','incomplete-review','tool-call-builder'])test('actual pi adapter wire fixture: '+scenario,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'alpha-pi-wire-trial-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const result=await runTeamTrial({directory,operationId:'wire-'+scenario,fixture:true,wireFixture:true,wireFixtureScenario:scenario,settings});
 assert.equal(result.paidModelCalls,0);assert.equal(result.usage.synthetic,true);assert.equal(result.usage.inferenceRequests,0);assert.equal(result.qualityAcceptanceGranted,false);
 if(scenario==='complete'){
  assert.equal(result.status,'fixture_complete');assert.equal(result.process.code,0);assert.equal(result.wireFixture,true);assert.equal(new Set(result.children).size,4);assert.equal(result.usage.fixtureRequests,4);assert.ok(result.usage.requests.every(request=>request.completed&&request.usage.input_tokens===20));
 }else if(scenario==='incomplete-review'){
  assert.equal(result.status,'blocked');assert.equal(result.usage.fixtureRequests,4);assert.equal(result.usage.requests[3].completed,false);assert.equal(result.usage.requests[3].usage.output_tokens,7);
 }else{
  assert.equal(result.status,'blocked');assert.equal(result.usage.fixtureRequests,1);
 }
});
