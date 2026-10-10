/** Deterministic text-only responses shared by adapter and wire fixtures. */
import {requireThat} from '../core.mjs';
import {fixtureResponse} from '../fixtures.mjs';
export function trialFixtureResponse(texts){
  const builder=texts.find(t=>t.startsWith('ALPHA_TRIAL_BUILD\n'));
  if(builder){
   const input=JSON.parse(builder.slice('ALPHA_TRIAL_BUILD\n'.length));
   return {objective:input.goal,members:[{id:'checklist-writer',modelRef:input.modelRef,shadowModelRef:input.modelRef,responsibility:'Turn supplied requirements into a checked list',skills:['alpha-evidence'],tools:[]}],steps:[{id:'write-checklist',owner:'checklist-writer',dependsOn:[],input:input.goal,output:'A numbered checklist',check:'Every supplied requirement is represented once',onFailure:'stop'}],gaps:[],acceptance:input.acceptance};
  }
  const inputText=texts.findLast(t=>t.includes('ALPHA_INPUT_JSON\n'));
  requireThat(inputText,'TRIAL_INPUT','Expected native Alpha input');
  const input=JSON.parse(inputText.slice(inputText.indexOf('ALPHA_INPUT_JSON\n')+'ALPHA_INPUT_JSON\n'.length));
  const phase=input.subjectHash?'review':texts.some(t=>t.includes('"coverage"'))?'prepare':'draft';
  const response=fixtureResponse({role:{id:'step:0'},phase,input});
  if(phase==='draft')response.artifact={checklist:['Bring water','Confirm the address','Leave ten minutes early'],testOnly:true};
  return response;
}
