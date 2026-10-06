/** Optional, repository-local Cordis extension. Launch only through the supported dsh profile. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { resolve,join } from 'node:path';
import { loadTeam,preflight,readJson,requireThat,digest } from './core.mjs';
import { AlphaRunner,RunStore } from './runner.mjs';
import { createDshExecutor } from './dsh-adapter.mjs';

const requireDsh=createRequire(new URL('../packages/subagent/tool-subagent/package.json',import.meta.url));
const {defineTool}=await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-tools')).href);
export const name='dsh-alpha-team';
export const inject=['tools','subagents','llm'];
const textOutput={schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]};

/** No network request or model call occurs merely by loading this plugin. */
export function apply(ctx,config={}) {
  let active=false;
  const readConfig=()=>readJson(config.modelConfigPath?resolve(config.modelConfigPath):new URL('models.example.json',import.meta.url));
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'alpha_preflight',description:'Check Alpha roster, locked skills and model bindings. Does not call models. Missing configuration never counts as ready.',parameters:{},output:textOutput,
    async execute(){ const {team,revision}=await loadTeam(); const c=await readConfig(); return JSON.stringify({...preflight(team,c),logicalActors:team.logicalActors,revision,credentialProbePerformed:false}); },
  })));
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'alpha_build_team',
    description:'Research and build a candidate Agent team with seven specialist main/shadow pairs. Shadow preparation runs alongside the main. Requires operator-enabled model bindings. No final deployment or automatic acceptance. Default tools are read-only web tools; code execution and external installation are not provided by Alpha v0.1.',
    parameters:{goal:{type:'string',required:true},acceptance:{type:'array',required:true,items:{type:'string'}},constraints:{type:'array',items:{type:'string'}}},output:textOutput,
    async execute(args,exec){
      requireThat(exec.agent,'PARENT','A live DSH caller is required');
      requireThat(!active,'RUN_BUSY','Another Alpha run is active'); active=true;
      try {
        const loaded=await loadTeam(),c=await readConfig();
        const store=new RunStore(config.stateDirectory?resolve(config.stateDirectory):join(homedir(),'.dsh','alpha-runs'));
        const executor=createDshExecutor(ctx,exec.agent,{provider:c.subagentProvider});
        const runner=new AlphaRunner({...loaded,config:c,executor,store});
        const result=await runner.run({goal:args.goal,acceptance:args.acceptance,constraints:args.constraints??[]},exec.signal);
        return JSON.stringify({id:result.id,status:result.status,candidate:result.pairs.integrator.draft.artifact,candidateHash:result.candidateHash,delegationsReserved:result.delegationsReserved,mode:result.mode,reportFile:store.file,reportHash:digest(result)});
      } finally {active=false;}
    },
  })));
}
