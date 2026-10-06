import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTeam,validateTeam,validateBrief,preflight,validateOutput,validateCandidate,digest,copy} from '../core.mjs';
import {fixtureConfig,fixtureResponse,fixtureCandidate} from '../fixtures.mjs';
const loaded=await loadTeam(),team=loaded.team;
const brief={goal:'Create a research team',acceptance:['reproducible evidence']};

test('seven pairs contain fourteen distinct logical actors and ten locked skills',()=>{
 assert.equal(team.roles.length,7);assert.equal(new Set(team.roles.flatMap(r=>[r.primary,r.shadow])).size,14);assert.equal(Object.keys(loaded.skills).length,10);
});
test('lead does not own final integration',()=>{assert.deepEqual(team.roles.find(r=>r.id==='integrator').dependsOn,['architect','skill-lab','model-lab']);assert.equal(team.roles[0].tools.length,0);});
test('all roles share parallel-review and research methods',()=>{assert.ok(team.sharedSkills.includes('alpha-parallel-review'));assert.ok(team.sharedSkills.includes('alpha-rd'));});
test('canonical hash is independent of property order',()=>assert.equal(digest({b:2,a:1}),digest({a:1,b:2})));
test('default configuration refuses live execution',()=>assert.equal(preflight(team,{schemaVersion:1,liveEnabled:false,subagentProvider:'spawn',models:[],bindings:{}}).ready,false));
test('complete fixture bindings satisfy configuration checks, not production evidence',()=>assert.equal(preflight(team,fixtureConfig(team)).ready,true));
test('same real model under two aliases is refused',()=>{const c=fixtureConfig(team);c.models[1].canonicalModelId=c.models[0].canonicalModelId;assert.ok(preflight(team,c).issues.some(x=>x.startsWith('SAME_MODEL_PAIR')));});
test('same provider/model cannot be hidden with different canonical labels',()=>{const c=fixtureConfig(team);c.models[1].model='a';assert.equal(preflight(team,c).ready,false);});
test('missing pair binding is refused',()=>{const c=fixtureConfig(team);delete c.bindings.research;assert.ok(preflight(team,c).issues.includes('UNBOUND_PAIR:research'));});
test('credential-shaped or arbitrary model fields are not accepted',()=>{const c=fixtureConfig(team);c.models[0].apiKey='not-a-real-key';assert.ok(preflight(team,c).issues.includes('UNRECOGNIZED_MODEL_FIELD_OR_SECRET'));});
test('inherited-context backend is not an approved binding',()=>{const c=fixtureConfig(team);c.subagentProvider='fork';assert.ok(preflight(team,c).issues.includes('FRESH_SPAWN_REQUIRED'));});
test('duplicate model refs are refused',()=>{const c=fixtureConfig(team);c.models.push(c.models[0]);assert.equal(preflight(team,c).ready,false);});
test('invalid output budget is refused',()=>{const c=fixtureConfig(team);c.models[0].maxTokens=NaN;assert.equal(preflight(team,c).ready,false);});
test('unknown phase dependency is refused',()=>{const t=copy(team);t.roles[1].dependsOn=['missing'];assert.throws(()=>validateTeam(t),{code:'DEPENDENCY'});});
test('phase cycles are refused',()=>{const t=copy(team);t.roles[0].dependsOn=['research'];assert.throws(()=>validateTeam(t),{code:'CYCLE'});});
test('tool allowlist cannot silently add shell or state writes',()=>{const t=copy(team);t.roles[1].tools.push('bash');assert.throws(()=>validateTeam(t),{code:'TOOLS'});});
test('goal without acceptance criteria is refused',()=>assert.throws(()=>validateBrief({goal:'Build anything',acceptance:[]}),{code:'ACCEPTANCE'}));
test('preparation must include independent checks',()=>assert.throws(()=>validateOutput('prepare',{sources:[],coverage:['a'],checks:[],uncertainties:[]}),{code:'CHECKS'}));
test('source dates in the future are refused',()=>assert.throws(()=>validateOutput('prepare',{coverage:['a'],checks:['b'],uncertainties:[],sources:[{id:'s',url:'https://example.org',accessedAt:'2999-01-01',supports:'x'}]}),{code:'SOURCE_DATE'}));
test('file URLs and embedded credentials are refused as source references',()=>{
 for(const url of ['file:///etc/passwd','https://user:secret@example.org']) assert.throws(()=>validateOutput('prepare',{coverage:['a'],checks:['b'],uncertainties:[],sources:[{id:'s',url,accessedAt:'2026-01-01',supports:'x'}]}),{code:'SOURCE_URL'});
});
test('duplicate evidence ids are refused',()=>{const s={id:'s',url:'https://example.org',accessedAt:'2026-01-01',supports:'x'};assert.throws(()=>validateOutput('prepare',{coverage:['a'],checks:['b'],uncertainties:[],sources:[s,s]}),{code:'SOURCE_ID'});});
test('review of the wrong artifact version is refused',()=>assert.throws(()=>validateOutput('review',{sources:[],verdict:'pass',findings:[],checked:['x'],subjectHash:'old'},'new'),{code:'STALE_REVIEW'}));
test('a pass with unresolved blockers or risks is refused',()=>{
 for(const severity of ['blocker','risk']) assert.throws(()=>validateOutput('review',{sources:[],verdict:'pass',findings:[{severity,target:'x',reason:'x',evidence:'x',check:'x'}],checked:['x'],subjectHash:'h'},'h'),{code:'FALSE_PASS'});
});
test('a correct artifact can pass with zero findings',()=>assert.equal(validateOutput('review',{sources:[],verdict:'pass',findings:[],checked:['x'],subjectHash:'h'},'h').verdict,'pass'));
test('empty alternative list requires an explicit research-scope explanation',()=>{const v=fixtureResponse({role:team.roles[0],phase:'draft',input:{brief}});v.alternatives=[];assert.throws(()=>validateOutput('draft',v),{code:'ALTERNATIVES'});v.singleRouteReason='No other feasible route was found within the documented constraints';assert.ok(validateOutput('draft',v));});
test('claiming an experiment ran without a receipt is refused',()=>{const v=fixtureResponse({role:team.roles[0],phase:'draft',input:{brief}});v.experiments=[{status:'executed',method:'fake'}];assert.throws(()=>validateOutput('draft',v),{code:'EXPERIMENT'});});
test('oversized outputs are refused',()=>assert.throws(()=>validateOutput('prepare',{huge:'x'.repeat(1000)},undefined,100),{code:'OUTPUT'}));
test('generated candidate has execution-oriented fields rather than titles only',()=>assert.ok(validateCandidate(fixtureCandidate(brief))));
test('candidate without failure handling is refused',()=>{const c=fixtureCandidate(brief);delete c.steps[0].onFailure;assert.throws(()=>validateCandidate(c),{code:'CANDIDATE_STEP'});});
test('candidate with a dependency cycle is refused',()=>{const c=fixtureCandidate(brief);c.steps[0].dependsOn=['s1'];assert.throws(()=>validateCandidate(c),{code:'CANDIDATE_DAG'});});
test('candidate with unknown owner is refused',()=>{const c=fixtureCandidate(brief);c.steps[0].owner='ghost';assert.throws(()=>validateCandidate(c),{code:'CANDIDATE_STEP'});});
