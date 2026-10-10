/** Test-only provider and fault driver. Every Alpha invocation uses the real DSH tool pipeline. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {fixtureResponse,fixtureCandidate} from '../fixtures.mjs';
import {digest} from '../core.mjs';
const req=createRequire(new URL('../../packages/subagent/tool-subagent/package.json',import.meta.url));
const {defineTool}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-tools')).href);
const {LlmAdapter,ToolCallId}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-llm')).href);
const scenario=process.env.ALPHA_NATIVE_CASE??'team';
assert.ok(['team','research','cancel','failure','liveoff','borrowed','generated','generated-cancel','generated-failure'].includes(scenario));
const args={goal:'TEST ONLY bounded research',acceptance:['structural fixture check'],constraints:['No live model or network requests']};
const generated=fixtureCandidate(args);generated.members[0].id='writer-{{literal}}';generated.members[0].responsibility='Retain {{customer_name}} verbatim';generated.steps[0].owner=generated.members[0].id;generated.steps[0].input='Analyze {{customer_name}} placeholders';generated.members[0].tools=['web_fetch'];
const state={mode:scenario.replace('generated-',''),started:0,stopped:0,ready:Promise.withResolvers(),fetched:Promise.withResolvers()};
function* text(value){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:value};yield {type:'block-end',index:0,block:{type:'text',text:value}};yield {type:'usage',usage:{inputTokens:10,outputTokens:10}};yield {type:'finish',reason:{kind:'stop'}};}
function* tool(name,args,id){yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:ToolCallId(id),name,argumentsDelta:JSON.stringify(args)};yield {type:'block-end',index:0,block:{type:'tool-call',id:ToolCallId(id),name,arguments:JSON.stringify(args)}};yield {type:'finish',reason:{kind:'tool-calls'}};}
async function untilAborted(signal){assert.ok(signal);if(signal.aborted){state.stopped++;throw signal.reason;}await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{state.stopped++;reject(signal.reason);},{once:true}));}
class Fixture extends LlmAdapter{
 async *stream(options){
  const role=/DSH Alpha 0\.1\.0 \| role=([^ ]+) \| phase=(\w+)/.exec(options.system??options.messages.filter(m=>m.role==='system').flatMap(m=>m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n'));
  if(options.purpose){yield* text('Alpha native fixture');return;}
  if(role){
   const phase=role[2];assert.equal(options.model,['prepare','review'].includes(phase)?'b':'a');
   for(const forbidden of ['alpha_build_team','alpha_execute_team','alpha_research_pair','alpha_fixture_driver','bash','read','write','subagent'])assert.ok(!(options.tools??[]).some(t=>t.name===forbidden),`leaked tool ${forbidden}`);
   const inputText=options.messages.flatMap(m=>m.content??[]).findLast(b=>b.type==='text'&&b.text.includes('ALPHA_INPUT_JSON\n'))?.text;
   assert.ok(inputText);const input=JSON.parse(inputText.slice(inputText.indexOf('ALPHA_INPUT_JSON\n')+'ALPHA_INPUT_JSON\n'.length));
   if(scenario.startsWith('generated')){assert.equal(input.step.input,'Analyze {{customer_name}} placeholders');assert.equal(input.member.responsibility,'Retain {{customer_name}} verbatim');}
   if(phase==='prepare'){assert.ok(!Object.hasOwn(input,'draft'));assert.ok(!Object.hasOwn(input,'previous'));}
   if(phase==='review')assert.equal(input.subjectHash,digest(input.draft));
   const needsSource=(role[1].startsWith('step:')||['research','model-lab','skill-lab'].includes(role[1]))&&['prepare','draft'].includes(phase);
   const hasFetch=options.messages.some(m=>m.role==='tool'&&!m.isError);
   if(scenario!=='team'&&!scenario.startsWith('generated'))assert.equal(role[1],'research');
   if(needsSource&&!hasFetch&&scenario!=='team'){
    if(++state.started===2)state.ready.resolve();
    await state.ready.promise;
    if(state.mode==='cancel')await untilAborted(options.signal);
    if(state.mode==='failure'){
     if(phase==='prepare'){yield* text('not valid JSON');return;}
     await untilAborted(options.signal);
    }
    if(state.mode==='borrowed'&&phase==='prepare'){
     await state.fetched.promise;
     const response=fixtureResponse({role:{id:role[1]},phase,input});
     response.sources=[{id:'borrowed',url:'https://fixture.invalid/alpha-method/research/draft',accessedAt:new Date().toISOString(),supports:'TEST ONLY forbidden borrowed receipt'}];
     yield* text(JSON.stringify(response));return;
    }
   }
   const url=`https://fixture.invalid/alpha-method/${role[1]}/${phase}`;
   if(needsSource&&!hasFetch){yield* tool('web_fetch',{url},'alpha-fetch-'+role[1]+'-'+phase);return;}
   const response=fixtureResponse({role:{id:role[1]},phase,input});
   if(needsSource)response.sources=[{id:'fixture-source',url,accessedAt:new Date().toISOString(),supports:'TEST ONLY source receipt'}];
   yield* text(JSON.stringify(response));return;
  }
  const results=options.messages.filter(m=>m.role==='tool').flatMap(m=>m.content??[]).filter(b=>b.type==='text').map(b=>b.text);
  if(results.some(t=>t.includes('awaiting_human_acceptance')||t.includes('research_reviewed')||t.includes('ALPHA_FAULTS_VERIFIED'))){
   if(scenario==='generated'){
    if(results.length===1){yield* tool('alpha_execute_team',{operationId:scenario+'-standalone',candidateJson:JSON.stringify(generated)},'alpha-native-duplicate');return;}
    assert.equal(results.length,2);assert.deepEqual(JSON.parse(results[0]),JSON.parse(results[1]));assert.equal(state.started,2);
    const result=JSON.parse(results.find(t=>t.includes('awaiting_human_acceptance')));
    assert.equal(result.executionScope,'generated-team');assert.equal(result.qualityAcceptanceGranted,false);assert.ok(result.outputs.s1.testOnly);assert.equal(result.delegationsReserved,3);
   }
   if(scenario==='research'){
    const result=JSON.parse(results.find(t=>t.includes('research_reviewed')));
    assert.equal(result.executionScope,'research-pair');assert.equal(result.qualityAcceptanceGranted,false);
    assert.ok(result.artifact.testOnly);assert.equal(result.review.subjectHash,result.subjectHash);
    assert.equal(Object.hasOwn(result,'candidate'),false);assert.equal(Object.hasOwn(result,'candidateHash'),false);
   }
   yield* text('ALPHA_NATIVE_FIXTURE_OK');return;
  }
  if(results.length)throw new Error('Alpha native fixture failed: '+results.join('\n').slice(-3000));
  const name=scenario==='generated'?'alpha_execute_team':scenario==='team'?'alpha_build_team':scenario==='research'?'alpha_research_pair':'alpha_fixture_driver';
  assert.ok((options.tools??[]).some(t=>t.name===name));yield* tool(name,name==='alpha_fixture_driver'?{}:name==='alpha_execute_team'?{operationId:scenario+'-standalone',candidateJson:JSON.stringify(generated)}:args,'alpha-native-root');
 }
}
export const name='alpha-native-fixture';export const inject=['llm','tools'];
export function apply(ctx){
 ctx.llm.registerAdapter(['deepseek-official','fixture'],new Fixture());
 ctx.on('tools/result',(exec,result)=>{if(exec.name==='web_fetch'&&exec.arguments?.url==='https://fixture.invalid/alpha-method/research/draft'&&!result.isError)state.fetched.resolve();});
 ctx.on('agent/created',({agent})=>{
  agent.ctx.tools.register(defineTool({name:'web_fetch',description:'TEST ONLY no network fixture',parameters:{url:{type:'string',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(a){return 'TEST ONLY fetched fixture text: '+a.url;}}));
 });
 ctx.effect(()=>ctx.tools.register(defineTool({name:'alpha_fixture_driver',description:'TEST ONLY fault and shared-lock checks',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(_args,exec){
  let count=0;
  const generatedScenario=scenario.startsWith('generated');
  const selected=generatedScenario?'alpha_execute_team':'alpha_research_pair';
  const invoke=(name=selected,signal=exec.signal)=>ctx.tools.execute({name,arguments:name==='alpha_execute_team'?{operationId:scenario+'-'+count,candidateJson:JSON.stringify(generated)}:args,agent:exec.agent,signal,callId:ToolCallId('fixture-inner-'+(++count)),parent:exec.token,rootCallId:exec.rootCallId});
  const ctl=new AbortController();
  const first=invoke(selected,AbortSignal.any([exec.signal,ctl.signal]));
  if(scenario.endsWith('cancel')){
   await state.ready.promise;
   const busy=await invoke('alpha_build_team');assert.equal(busy.isError,true);assert.match(JSON.stringify(busy),/Another Alpha run is active/);
   ctl.abort(new Error('fixture caller cancellation'));
  }
  const failed=await first;assert.equal(failed.isError,true);
  if(scenario.endsWith('cancel'))assert.equal(state.stopped,2);
  if(scenario.endsWith('failure'))assert.ok(state.stopped>=1);
  if(scenario==='borrowed')assert.match(JSON.stringify(failed),/Research requires cited source text/);
  if(scenario==='liveoff'){
   assert.equal(state.started,0);assert.match(JSON.stringify(failed),/LIVE_DISABLED/);
   const again=await invoke();assert.equal(again.isError,true);assert.match(JSON.stringify(again),/LIVE_DISABLED/);assert.equal(state.started,0);
  }else{
   state.mode='research';state.started=0;state.ready=Promise.withResolvers();state.fetched=Promise.withResolvers();
   const again=await invoke();assert.equal(again.isError,false);const value=JSON.parse(again.value);
   assert.equal(value.status,generatedScenario?'awaiting_human_acceptance':'research_reviewed');assert.equal(value.qualityAcceptanceGranted,false);assert.equal(value.delegationsReserved,3);
  }
  return 'ALPHA_FAULTS_VERIFIED';
 }})));
}
