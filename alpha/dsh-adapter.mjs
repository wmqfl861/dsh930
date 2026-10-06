/** Native DSH bridge; uses fresh subagent runs rather than the experimental team spawn tool. */
import { AlphaError, requireThat, digest } from './core.mjs';

export const outputInstructions = {
  prepare: 'Return ONLY JSON: {"coverage":["questions investigated"],"sources":[{"id":"s1","url":"https://...","accessedAt":"ISO8601","supports":"exact supported claim"}],"checks":["independent checks prepared"],"uncertainties":[]}. Sources may be empty if none actually fetched. Do not invent evidence.',
  draft: 'Return ONLY JSON: {"summary":"...","artifact":{},"sources":[],"alternatives":[{"route":"...","reason":"..."}],"openQuestions":[],"experiments":[{"status":"not_executed","method":"..."}]}. If only one route exists, alternatives may be empty but singleRouteReason must explain the search scope. Sources use {id,url,accessedAt,supports}. Executed experiments require status=executed and a real receipt reference. Integrator artifact MUST contain {objective,members:[{id,modelRef,responsibility,skills:[],tools:[]}],steps:[{id,owner,dependsOn:[],input,output,check,onFailure}],gaps:[],acceptance:[]}; unresolved capabilities remain in gaps. Evaluator artifact MUST contain acceptedCandidateHash equal to the exact integrated candidate hash provided by the host, only if evaluated; otherwise return unresolved questions.',
  review: 'Return ONLY JSON: {"subjectHash":"exact hash provided by host","verdict":"pass|revise|blocked","sources":[],"checked":["checks actually performed"],"findings":[{"severity":"blocker|risk|suggestion","target":"...","reason":"...","evidence":"specific evidence or counterexample","check":"how to verify resolution"}]}. pass cannot coexist with unresolved blockers or risks. No minimum finding count. Do not invent tests or sources.',
};

/** Adapter consumes an already authorized live parent, never credentials in tool arguments. */
export function createDshExecutor(ctx,parent,{provider='spawn',onReceipt=()=>{}}={}) {
  const mode='dsh';
  return {
    mode,
    async preflight(team,config,signal) {
      const backend=ctx.subagents.getProvider(provider);
      requireThat(backend && backend.inheritsParentContext===false,'DSH_FRESH_PROVIDER','Fresh DSH spawn provider is required');
      for(const capability of ['agentOptions','persona','toolFilter','depthLimit']) {
        requireThat(backend.capabilities[capability]===true,'DSH_CAPABILITY',`Provider lacks ${capability}`);
      }
      const visible=new Set(ctx.tools.schemas(parent).map(t=>t.name));
      for(const t of new Set(team.roles.flatMap(r=>r.tools))) requireThat(visible.has(t),'DSH_TOOL_MISSING',`Missing tool: ${t}`);
      // Metadata resolution validates actual routes; a separate user-approved smoke must test credentials/backend connectivity.
      for(const m of config.models) await ctx.llm.resolveCallConfig({provider:m.provider,model:m.model,...(m.reasoningEffort?{reasoningEffort:m.reasoningEffort}:{})},signal);
    },
    async execute({actor,role,phase,model,input,persona,signal}) {
      const instructions=outputInstructions[phase==='revise'?'draft':phase];
      requireThat(instructions,'PHASE','Unsupported actor phase');
      signal.throwIfAborted();
      let run;
      const observed=[];
      requireThat(typeof ctx.on==='function','DSH_OBSERVER','Native result observer is required');
      const disposeObserver=ctx.on('tools/result',(exec,result)=>{
        if(['web_search','web_fetch'].includes(exec.name)&&observed.length<256) observed.push({agent:exec.agent,tool:exec.name,callId:exec.callId,isError:result.isError,url:exec.name==='web_fetch'?exec.arguments?.url:undefined,contentHash:digest(result.content),at:new Date().toISOString()});
      });
      try {
        run=await ctx.subagents.start(provider,{
          parent,signal,label:`alpha:${actor}:${phase}`,
          agentOptions:{provider:model.provider,model:model.model,maxTokens:model.maxTokens,...(model.reasoningEffort?{reasoningEffort:model.reasoningEffort}:{})},
          // Alpha owns orchestration; delegates cannot create unbounded descendants or edit shared state.
          maxDepth:1,toolFilter:{allow:role.tools},persona,
          prompt:[{type:'text',text:instructions},{type:'text',text:'ALPHA_INPUT_JSON\n'+JSON.stringify(input)}],
        });
        onReceipt({actor,phase,childId:run.id,provider:model.provider,model:model.model});
        let rejectAbort;
        const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(signal.reason??new AlphaError('CANCELLED','Actor cancelled'));});
        signal.addEventListener('abort',rejectAbort,{once:true});
        if(signal.aborted) rejectAbort();
        let result;
        try { result=await Promise.race([run.result,aborted]); }
        finally { signal.removeEventListener('abort',rejectAbort); }
        requireThat(result.stopReason==='completed','DSH_CHILD_FAILED',`Subagent stopped: ${result.stopReason}`);
        const text=result.output.filter(b=>b.type==='text').map(b=>b.text).join('');
        requireThat(Buffer.byteLength(text)<=262144,'DSH_OUTPUT_LIMIT','Subagent JSON exceeds the adapter acquisition bound');
        let value;
        try { value=JSON.parse(text); } catch { throw new AlphaError('DSH_JSON','Subagent did not return valid standalone JSON'); }
        const receipts=observed.filter(r=>r.agent===run.localAgent).map(({agent:_agent,...r})=>r);
        if(['research','model-lab','skill-lab'].includes(role.id)&&['draft','prepare'].includes(phase)) {
          const fetched=new Set(receipts.filter(r=>r.tool==='web_fetch'&&!r.isError).map(r=>r.url));
          requireThat(value.sources?.some(s=>fetched.has(s.url)), 'RESEARCH_NOT_FETCHED', 'Research requires cited source text actually fetched by this exact child; search snippets/self-report are insufficient');
        }
        return {...value,_host:{childId:run.id,provider:model.provider,model:model.model,toolReceipts:receipts}};
      } finally {
        disposeObserver();
        if(run) await run.dispose();
      }
    },
  };
}
