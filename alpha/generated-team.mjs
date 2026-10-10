/** Compile generated team packages into the same reviewed runtime used by Alpha. */
import {copy,digest,nonempty,object,preflight,requireThat,validateBrief,validateCandidate,validateRuntimeTeam} from './core.mjs';
import {AlphaRunner} from './runner.mjs';
import {executeGeneratedInvocation} from './generated-invocation.mjs';

/**
 * Resolve a model-produced package against operator-owned skills, models and limits.
 * No generated field may expand tool permissions or change execution budgets.
 * @param {object} options Candidate plus the loaded Alpha assets and configured routes.
 * @returns {object} Captured runtime team, skills, revision and model bindings.
 */
export function compileGeneratedTeam({candidate,team,skills,revision,config}) {
  requireThat(object(candidate) && Buffer.byteLength(JSON.stringify(candidate)) <= team.limits.maxResultBytes,'BLUEPRINT_SIZE','Expected a bounded team package');
  validateCandidate(candidate);
  if(config.executionPurpose==='single-model-team-trial') requireThat(candidate.members.length===1&&candidate.steps.length===1&&candidate.members[0].tools.length===0,'TEAM_TRIAL_SCOPE_REQUIRED','Same-model trial requires exactly one tool-free member and one step');
  requireThat(candidate.gaps.length===0,'CANDIDATE_GAPS','Resolve capability gaps before execution');
  requireThat(candidate.acceptance.every(nonempty),'CANDIDATE_GATES','Acceptance requirements must be non-empty strings');
  requireThat(candidate.steps.length*3<=team.limits.maxDelegations,'DELEGATION_BUDGET','No budget for all generated main/shadow steps');
  requireThat(['team-building','single-model-team-trial'].includes(config.executionPurpose??'team-building'),'GENERATED_REVIEW','Generated teams require independent-model review or an explicit same-model trial');
  const members=new Map();
  for(const member of candidate.members) {
    requireThat(nonempty(member.shadowModelRef),'BLUEPRINT_REVIEWER','Each member requires an independent shadow model reference');
    requireThat(member.skills.every(name=>nonempty(name)&&Object.hasOwn(skills,name)),'BLUEPRINT_SKILL','Generated skills must exist in the locked inventory');
    requireThat(member.tools.every(name=>['web_search','web_fetch'].includes(name)),'BLUEPRINT_TOOL','Generated teams may only use supported read-only web tools');
    members.set(member.id,member);
  }
  const bindings={};
  const stepIds=new Map(candidate.steps.map((step,index)=>[step.id,'step:'+index]));
  const roles=candidate.steps.map(step=>{
    const member=members.get(step.owner);
    requireThat(step.onFailure==='stop','BLUEPRINT_FAILURE_POLICY','Only fail-closed stop is executable; other recovery policies need operator implementation');
    const id=stepIds.get(step.id);
    bindings[id]={primary:member.modelRef,shadow:member.shadowModelRef};
    return {id,title:'Generated specialist',primary:id+':primary',shadow:id+':shadow',mission:'Complete the generated assignment in ALPHA_INPUT_JSON',skills:copy(member.skills),tools:copy(member.tools),requiresFetchedSources:member.tools.includes('web_fetch'),dependsOn:step.dependsOn.map(dep=>stepIds.get(dep)),member:copy(member),task:copy(step)};
  });
  requireThat(candidate.members.every(member=>candidate.steps.some(step=>step.owner===member.id)),'BLUEPRINT_UNUSED_MEMBER','Every generated member must own a step');
  const runtime={schemaVersion:1,kind:'generated-team',blueprintHash:digest(candidate),id:'generated:'+digest(candidate),version:'1',logicalActors:roles.length*2,sharedSkills:copy(team.sharedSkills),limits:copy(team.limits),roles};
  validateRuntimeTeam(runtime);
  const resolvedConfig={...copy(config),bindings};
  const admission=preflight(runtime,resolvedConfig);
  requireThat(admission.ready,'PREFLIGHT',admission.issues.join(', '));
  return {team:runtime,skills:copy(skills),revision:digest({sourceRevision:revision,candidate}),config:resolvedConfig};
}

/**
 * Execute an explicitly supplied generated package; completion is never human acceptance.
 * @param {object} options Compiler assets, candidate, executor, store and optional signal.
 * @returns {Promise<object>} Durable reviewed step outputs with fixture/live evidence labels.
 */
export async function runGeneratedTeam(options) {
  const compiled=compileGeneratedTeam(options);
  const brief={goal:options.candidate.objective,acceptance:copy(options.candidate.acceptance),constraints:copy(options.constraints??[])};
  validateBrief(brief);
  options.signal?.throwIfAborted();
  const fingerprint=digest({blueprint:options.candidate,brief,revision:compiled.revision,config:compiled.config,executorMode:options.executor.mode,offlineMode:options.executor.offlineMode??null});
  return executeGeneratedInvocation({operationId:options.operationId,fingerprint,directory:options.store.directory,execute:invocation=>new AlphaRunner({...compiled,executor:options.executor,store:options.store,executionScope:'generated-team',invocation}).run(brief,options.signal)});
}
