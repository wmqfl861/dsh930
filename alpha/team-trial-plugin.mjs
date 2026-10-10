/** Native same-model diagnostic controller; delegates generation and execution to fresh sessions. */
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadTeam,digest,requireThat} from './core.mjs';
import {compileGeneratedTeam} from './generated-team.mjs';
import {executeGeneratedInvocation} from './generated-invocation.mjs';
import {trialFixtureResponse} from './tests/team-trial-responses.mjs';
const require=createRequire(new URL('../packages/subagent/tool-subagent/package.json',import.meta.url));
const {defineTool}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
const {LlmAdapter,ToolCallId}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
function* text(value){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:value};yield {type:'block-end',index:0,block:{type:'text',text:value}};yield {type:'finish',reason:{kind:'stop'}};}
class Controller extends LlmAdapter {
 async *stream(options){
  if(options.purpose||options.messages.some(m=>m.role==='tool')){yield* text('ALPHA_TEAM_TRIAL_DRIVER_FINISHED');return;}
  const id=ToolCallId('trial-controller'),name='alpha_team_trial_driver',args='{}';
  yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:args};yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:args}};yield {type:'finish',reason:{kind:'tool-calls'}};
 }
}
/** Test-only adapter substitutes content, never grants live quality acceptance. */
class TrialFixture extends LlmAdapter {
 async resolveModel(provider,model){return {provider,id:model,name:model,reasoning:{efforts:[{id:"max",name:"Max"}]}};}
 async *stream(options){
  requireThat((options.tools??[]).length===0,'TRIAL_TOOLS','Trial children cannot access tools');
  const texts=options.messages.flatMap(m=>m.content??[]).filter(b=>b.type==='text').map(b=>b.text);
  yield* text(JSON.stringify(trialFixtureResponse(texts)));
 }
}
export const name='alpha-team-trial-driver';
export const inject=['llm','subagents','tools'];
export async function apply(ctx,settings){
 const config=JSON.parse(await readFile(settings.modelConfigPath,'utf8'));
 const [model]=config.models;
 ctx.llm.registerAdapter(['alpha-trial-controller'],new Controller());
 if(settings.fixture&&!settings.wireFixture)ctx.llm.registerAdapter([model.provider],new TrialFixture());
 ctx.effect(()=>ctx.tools.register(defineTool({name:'alpha_team_trial_driver',description:'Generate and execute one bounded same-model team trial. No media, tools, automatic retries or quality acceptance.',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(_args,exec){
  try{
   const loaded=await loadTeam();
   const result=await executeGeneratedInvocation({operationId:settings.operationId,fingerprint:digest({settings,config}),directory:join(settings.stateDirectory,'trial-operations'),execute:async invocation=>{
    let child;
    let candidate,builderChildId;
    try{
     child=await ctx.subagents.start('spawn',{parent:exec.agent,signal:exec.signal,label:'alpha:trial-blueprint',agentOptions:{provider:model.provider,model:model.model,reasoningEffort:model.reasoningEffort,maxTokens:model.maxTokens},maxDepth:1,toolFilter:{allow:[]},persona:'Build one small specialist team from the supplied requirement. Return ONLY JSON {objective,members:[{id,modelRef,shadowModelRef,responsibility,skills:[],tools:[]}],steps:[{id,owner,dependsOn:[],input,output,check,onFailure:"stop"}],gaps:[],acceptance:[]}. Copy the supplied goal verbatim into objective and copy acceptance exactly. Exactly one member and one step; tools must be empty. Use only the supplied modelRef for both sides and availableSkills. This is explicitly same-model contextual review, not heterogeneous-model review or quality acceptance.',prompt:[{type:'text',text:'ALPHA_TRIAL_BUILD\n'+JSON.stringify({goal:settings.goal,acceptance:settings.acceptance,modelRef:model.id,availableSkills:Object.keys(loaded.skills)})}]});
     builderChildId=child.id;
     const output=await child.result;
     requireThat(output.stopReason==='completed','TRIAL_BUILDER_FAILED','Builder did not complete');
     const raw=output.output.filter(b=>b.type==='text').map(b=>b.text).join('');
     requireThat(Buffer.byteLength(raw)<=loaded.team.limits.maxResultBytes,'BLUEPRINT_SIZE','Builder output is too large');
     candidate=JSON.parse(raw);
    }finally{if(child)await child.dispose();}
    requireThat(candidate.members?.length===1&&candidate.steps?.length===1&&candidate.members[0].tools?.length===0,'TRIAL_SCOPE','Trial requires one tool-free member and one step');
    requireThat(candidate.objective===settings.goal&&digest(candidate.acceptance)===digest(settings.acceptance),'TRIAL_REQUIREMENT','Generated team must preserve the original goal and acceptance requirements exactly');
    compileGeneratedTeam({...loaded,config,candidate});
    const execution=await ctx.tools.execute({name:'alpha_execute_team',arguments:{operationId:settings.operationId+'-execute',candidateJson:JSON.stringify(candidate),constraints:['No media generation','Same-model contextual review only']},agent:exec.agent,signal:exec.signal,callId:ToolCallId('trial-execute'),parent:exec.token,rootCallId:exec.rootCallId});
    requireThat(!execution.isError,'TRIAL_EXECUTION','Generated-team execution failed');
    const value=JSON.parse(execution.value);
    const state=JSON.parse(await readFile(value.reportFile,'utf8'));
    const pair=state.pairs['step:0'];
    const children=[builderChildId,...[pair.prep,pair.draft,pair.review].map(v=>v._host.childId)];
    requireThat(new Set(children).size===4,'TRIAL_FRESHNESS','Four fresh native sessions are required');
    requireThat(pair.review.subjectHash===digest(pair.draft),'TRIAL_REVIEW_SUBJECT','Review must bind the exact draft');
    if(!settings.fixture||settings.wireFixture){const guard=globalThis[Symbol.for('dsh.alpha.team-trial.guard')];requireThat(guard,'TRIAL_GUARD','Live trial request guard is required');await guard.flush();requireThat(guard.verified(),'TRIAL_WIRE','Four completed model requests required');}
    return {invocation,status:settings.fixture?'fixture_complete':'same_model_trial_reviewed',nativeDsh:true,fixture:settings.fixture,wireFixture:settings.wireFixture===true,qualityAcceptanceGranted:false,independentReviewConfigured:false,reviewKind:'same-model-fresh-contexts',candidate,blueprintHash:value.blueprintHash,children,execution:value};
   }});
   await writeFile(settings.reportPath,JSON.stringify(result,null,2)+'\n',{mode:0o600});return JSON.stringify(result);
  }catch(error){
   await globalThis[Symbol.for('dsh.alpha.team-trial.guard')]?.flush();
   await writeFile(settings.reportPath,JSON.stringify({status:'blocked',code:error.code??'TRIAL_FAILED',qualityAcceptanceGranted:false})+'\n',{mode:0o600});throw error;
  }
 }})));
}
