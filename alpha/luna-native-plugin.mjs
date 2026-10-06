/** Probe driver: deterministic controller, genuine DSH child + provider + native echo tool loop. */
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
const require = createRequire(new URL('../packages/subagent/tool-subagent/package.json', import.meta.url));
const {defineTool} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
const {LlmAdapter,ToolCallId} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
function* text(value) {
  yield {type:'block-start',index:0,blockType:'text'}; yield {type:'text-delta',index:0,text:value};
  yield {type:'block-end',index:0,block:{type:'text',text:value}}; yield {type:'finish',reason:{kind:'stop'}};
}
class ProbeController extends LlmAdapter {
  async *stream(options) {
    if (options.purpose) {yield* text('Luna diagnostic');return;}
    if(options.messages.some(m=>m.role==='tool')) {yield* text('LUNA_NATIVE_DRIVER_FINISHED');return;}
    const id=ToolCallId('native-probe'),name='luna_native_probe',args='{}';
    yield {type:'block-start',index:0,blockType:'tool-call'};
    yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:args};
    yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:args}};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  }
}
export const name='luna-native-probe';
export const inject=['llm','subagents','tools'];
export async function apply(ctx) {
  const state=JSON.parse(await readFile(process.env.ALPHA_LUNA_GUARD_CONFIG,'utf8'));
  const guard=globalThis[Symbol.for('dsh.alpha.luna.guard')];
  if(!guard) throw Error('NATIVE_GUARD_REQUIRED');
  ctx.llm.registerAdapter(['alpha-probe-controller'],new ProbeController());
  let used=false,echoes=0;
  ctx.tools.register(defineTool({name:'alpha_echo',description:'Return the nonce unchanged. No files, network or external effects.',
    parameters:{nonce:{type:'string',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},
    execute(args){if(args.nonce!==state.nonce||++echoes>1)throw Error('ECHO_NOT_VERIFIED');return args.nonce;}}));
  ctx.tools.register(defineTool({name:'luna_native_probe',description:'Run exactly one bounded Luna child.',parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(_args,exec){
      if(used)throw Error('NATIVE_PROBE_ALREADY_RUN');used=true; let run;
      try {
        await ctx.llm.resolveCallConfig({provider:'alpha-smoke-gateway',model:'gpt-6-luna',reasoningEffort:'max'},exec.signal);
        run=await ctx.subagents.start('spawn',{parent:exec.agent,signal:exec.signal,label:'Luna max wire diagnostic',
          agentOptions:{provider:'alpha-smoke-gateway',model:'gpt-6-luna',reasoningEffort:'max',maxTokens:4096},
          maxDepth:1,toolFilter:{allow:['alpha_echo']},persona:'This is a transport diagnostic, not a production task. Use the provided echo tool exactly once.',
          prompt:[{type:'text',text:'Call alpha_echo with nonce '+state.nonce+'. After receiving the tool result, reply with exactly that nonce and nothing else.'}]});
        const result=await run.result;
        const value=result.output.filter(x=>x.type==='text').map(x=>x.text).join('').trim();
        await guard.flush();
        if(result.stopReason!=='completed'||value!==state.nonce||echoes!==1)throw Error('NATIVE_ROUNDTRIP_NOT_VERIFIED');
        guard.verified=true;return 'LUNA_NATIVE_ROUNDTRIP_VERIFIED';
      } catch {guard.verified=false;return 'LUNA_NATIVE_ROUNDTRIP_NOT_VERIFIED';}
      finally {if(run)await run.dispose();await guard.flush();}
    }}));
}
