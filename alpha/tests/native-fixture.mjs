/** Test-only provider exercising real DSH CLI, tool dispatch, subagent lifecycle and model overrides. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {fixtureResponse} from '../fixtures.mjs';
const req=createRequire(new URL('../../packages/subagent/tool-subagent/package.json',import.meta.url));
const {defineTool}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-tools')).href);
const {LlmAdapter,ToolCallId}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-llm')).href);
function* text(text){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'usage',usage:{inputTokens:10,outputTokens:10}};yield {type:'finish',reason:{kind:'stop'}};}
class Fixture extends LlmAdapter{
 async *stream(options){
  const role=/DSH Alpha 0\.1\.0 \| role=([a-z-]+) \| phase=(\w+)/.exec(options.system??options.messages.filter(m=>m.role==='system').flatMap(m=>m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n'));
  if(options.purpose){yield* text('Alpha native fixture');return;}
  if(role){
   const phase=role[2];assert.equal(options.model,['prepare','review'].includes(phase)?'b':'a');
   const tools=(options.tools??[]).map(t=>t.name);for(const forbidden of ['alpha_build_team','bash','read','write','subagent'])assert.ok(!tools.includes(forbidden),`leaked tool ${forbidden}`);
   const inputText=options.messages.flatMap(m=>m.content??[]).findLast(b=>b.type==='text'&&b.text.includes('ALPHA_INPUT_JSON\n'))?.text;
   assert.ok(inputText);const input=JSON.parse(inputText.slice(inputText.indexOf('ALPHA_INPUT_JSON\n')+'ALPHA_INPUT_JSON\n'.length));
   if(phase==='prepare')assert.ok(!Object.hasOwn(input,'draft'));
   const needsSource=['research','model-lab','skill-lab'].includes(role[1])&&['prepare','draft'].includes(phase);
   const hasFetch=options.messages.some(m=>m.role==='tool'&&!m.isError);
   if(needsSource&&!hasFetch){
    const id=ToolCallId('alpha-fetch-'+role[1]+'-'+phase),name='web_fetch',args=JSON.stringify({url:'https://fixture.invalid/alpha-method'});
    yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:args};yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:args}};yield {type:'finish',reason:{kind:'tool-calls'}};return;
   }
   const response=fixtureResponse({role:{id:role[1]},phase,input});
   if(needsSource)response.sources=[{id:'fixture-source',url:'https://fixture.invalid/alpha-method',accessedAt:new Date().toISOString(),supports:'TEST ONLY source receipt'}];
   yield* text(JSON.stringify(response));return;
  }
  const results=options.messages.filter(m=>m.role==='tool').flatMap(m=>m.content??[]).filter(b=>b.type==='text').map(b=>b.text);
  if(results.some(t=>t.includes('awaiting_human_acceptance'))){yield* text('ALPHA_NATIVE_FIXTURE_OK: simulated providers, real DSH lifecycle, no paid model calls.');return;}
  if(results.length)throw new Error('Alpha native fixture failed: '+results.join('\n').slice(-3000));
  assert.ok((options.tools??[]).some(t=>t.name==='alpha_build_team'));
  const id=ToolCallId('alpha-native-build'),name='alpha_build_team',args=JSON.stringify({goal:'TEST ONLY build research team',acceptance:['structural fixture check'],constraints:['No live model or network requests']});
  yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:args};yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:args}};yield {type:'usage',usage:{inputTokens:10,outputTokens:10}};yield {type:'finish',reason:{kind:'tool-calls'}};
 }
}
export const name='alpha-native-fixture';export const inject=['llm'];
export function apply(ctx){
 ctx.llm.registerAdapter(['deepseek-official','fixture'],new Fixture());
 ctx.on('agent/created',({agent})=>{
  agent.ctx.tools.register(defineTool({name:'web_fetch',description:'TEST ONLY no network fixture',parameters:{url:{type:'string',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){return 'TEST ONLY fetched fixture text; not external evidence';}}));
 });
}
