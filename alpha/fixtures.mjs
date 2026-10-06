/** Deterministic TEST-ONLY data. It is neither research evidence nor a real model benchmark. */
import { copy } from './core.mjs';
export function fixtureConfig(team) {
  return {schemaVersion:1,liveEnabled:true,subagentProvider:'spawn',models:[
    {id:'fixture-a',provider:'fixture',model:'a',canonicalModelId:'fixture/a',family:'fixture-a',maxTokens:4096},
    {id:'fixture-b',provider:'fixture',model:'b',canonicalModelId:'fixture/b',family:'fixture-b',maxTokens:4096},
  ],bindings:Object.fromEntries(team.roles.map(r=>[r.id,{primary:'fixture-a',shadow:'fixture-b'}]))};
}
export function fixtureCandidate(brief) {
  return {objective:brief.goal,members:[{id:'worker',modelRef:'fixture-a',responsibility:'TEST ONLY: summarize supplied material',skills:['test-only'],tools:[]}],steps:[{id:'s1',owner:'worker',dependsOn:[],input:'supplied brief',output:'summary',check:'fixture check',onFailure:'stop'}],gaps:[],acceptance:brief.acceptance};
}
export function fixtureResponse({role,phase,input}) {
  if(phase==='prepare') return {coverage:['check explicit user requirements'],checks:['compare the submitted artifact with the exact brief'],sources:[],uncertainties:[]};
  if(phase==='review') return {subjectHash:input.subjectHash,verdict:'pass',findings:[],checked:['TEST ONLY structural response'],sources:[]};
  const artifact=role.id==='integrator'?fixtureCandidate(input.brief):role.id==='evaluator'?{acceptedCandidateHash:input.candidateHash,testOnly:true}:{testOnly:true,role:role.id};
  return {summary:'TEST ONLY; not a researched result',artifact,sources:[],alternatives:[{route:'single-agent baseline',reason:'fixture control'}],openQuestions:[],experiments:[{method:'No real experiment performed',status:'not_executed'}]};
}
export function fixtureExecutor(hook=()=>{}) {
  return {mode:'fixture',async execute(call){call.signal.throwIfAborted();await hook(call);return copy(fixtureResponse(call));}};
}
