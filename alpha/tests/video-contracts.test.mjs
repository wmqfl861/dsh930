import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateVideoPlan,inspectVideoReadiness,validateVideoReviewRecord} from '../video-contracts.mjs';
import {copy,digest} from '../core.mjs';
const fixture=JSON.parse(await readFile(new URL('../evals/video-contract.fixture.json',import.meta.url),'utf8'));
const plan=()=>copy(fixture);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function reorder(value){if(Array.isArray(value))return value.map(reorder);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)]));return value;}

test('three-shot draft validates without inventing endpoints, models, duration, prices or permission',()=>{
 const result=validateVideoPlan(freeze(plan()));assert.equal(result.plan.shots.length,3);assert.deepEqual(result.plan,fixture);
 assert.equal(result.planHash,digest(result.plan));
 const ready=inspectVideoReadiness(fixture);
 assert.equal(ready.schemaValid,true);assert.equal(ready.readiness,'blocked');assert.equal(ready.generationPermitted,false);assert.equal(ready.liveExecutionEnabled,false);
 for(const code of ['ENDPOINT_MISSING','MODEL_MAPPING_MISSING','CAPABILITIES_MISSING','RATE_MISSING','BUDGET_MISSING','APPROVAL_MISSING'])assert.ok(ready.missing.includes(code));
 assert.equal(ready.missing.filter(code=>code.startsWith('SHOT_DURATION_MISSING:')).length,3);
 assert.equal(ready.missing.filter(code=>code.startsWith('SHOT_ASPECT_RATIO_MISSING:')).length,3);
});

test('fully declared metadata still needs verified mapping, capabilities, rate, budget and approval',()=>{
 const value=plan();Object.assign(value.relayProfile,{endpoint:'https://relay.example.test/proxy/v1?region=west',modelRef:'operator-route',capabilities:['text-to-video'],pricingRef:'operator-rate-card'});
 for(const shot of value.shots)Object.assign(shot,{durationSeconds:4.5,aspectRatio:'16:9',resolution:{width:1920,height:1080},inputMode:'text-to-video'});
 const ready=inspectVideoReadiness(value,{approved:true,budget:100,capabilitiesConfirmed:true});
 assert.deepEqual(ready.missing,['MODEL_MAPPING_UNCONFIRMED','CAPABILITIES_UNCONFIRMED','RATE_UNCONFIRMED','BUDGET_MISSING','APPROVAL_MISSING','REVIEW_INVALID']);
 assert.equal(ready.executionBlocker,'OFFLINE_MODULE');assert.equal(ready.generationPermitted,false);assert.equal(ready.liveExecutionEnabled,false);
});

test('optional draft fields may be absent, and validators never add defaults',()=>{
 const value=plan();for(const field of ['endpoint','modelRef','capabilities','pricingRef'])delete value.relayProfile[field];
 for(const shot of value.shots){delete shot.durationSeconds;delete shot.aspectRatio;}
 assert.deepEqual(validateVideoPlan(value).plan,value);assert.equal(inspectVideoReadiness(value).generationPermitted,false);
});

test('configured nonsecret HTTP(S) URLs are not constrained to a vendor host or path',()=>{
 for(const endpoint of ['https://gateway.example.test/custom/v1?region=west#route-a','http://localhost:8080/relay','https://example.test/path?monkey=value']){
  const value=plan();value.relayProfile.endpoint=endpoint;assert.equal(validateVideoPlan(value).plan.relayProfile.endpoint,endpoint);
 }
});

test('canonical hashes ignore object key order and bind exact shot and profile revisions',()=>{
 const original=validateVideoPlan(fixture).planHash;assert.equal(validateVideoPlan(reorder(fixture)).planHash,original);
 for(const change of [v=>{v.shots[0].prompt+=' Changed.';},v=>{v.shots[0].revision++;},v=>{v.relayProfile.revision++;},v=>{v.relayProfile.endpoint='https://relay.example.test/v2';},v=>{v.briefRef.revision++;v.shots.forEach(s=>s.briefRef.revision++);},v=>{v.shots[0].durationSeconds=2;}]){
  const value=plan();change(value);assert.notEqual(validateVideoPlan(value).planHash,original);
 }
 const value=plan(),a=inspectVideoReadiness(value);value.relayProfile.revision++;const b=inspectVideoReadiness(value);
 assert.notEqual(a.relayProfileHash,b.relayProfileHash);assert.equal(a.shotsHash,b.shotsHash);
 value.shots[0].prompt+=' Changed.';assert.notEqual(b.shotsHash,inspectVideoReadiness(value).shotsHash);
});

test('returned plan is detached and the caller input remains unchanged',()=>{
 const value=plan(),before=copy(value),result=validateVideoPlan(value);result.plan.shots[0].prompt='local edit';result.plan.relayProfile.id='different';
 assert.deepEqual(value,before);inspectVideoReadiness(freeze(value));assert.deepEqual(value,before);
});

test('sequence gaps and nonstandard positive ratios remain declarations, not provider support claims',()=>{
 const value=plan();value.shots[2].sequence=8;value.shots[0].aspectRatio='7:3';assert.ok(validateVideoPlan(value));assert.equal(inspectVideoReadiness(value).generationPermitted,false);
});

const invalid=[
 ['duplicate shot id',v=>{v.shots[1].id=v.shots[0].id;},'DUPLICATE_SHOT'],
 ['duplicate sequence',v=>{v.shots[1].sequence=1;},'DUPLICATE_SEQUENCE'],
 ['descending sequence',v=>{[v.shots[0],v.shots[1]]=[v.shots[1],v.shots[0]];},'SHOT_SEQUENCE'],
 ['zero sequence',v=>{v.shots[0].sequence=0;},'SHOT_SEQUENCE'],
 ['fractional sequence',v=>{v.shots[0].sequence=1.5;},'SHOT_SEQUENCE'],
 ['invalid shot id',v=>{v.shots[0].id='';},'SHOT_VERSION'],
 ['zero shot revision',v=>{v.shots[0].revision=0;},'SHOT_VERSION'],
 ['string shot revision',v=>{v.shots[0].revision='1';},'SHOT_VERSION'],
 ['unknown plan schema',v=>{v.schemaVersion=2;},'SCHEMA_VERSION'],
 ['missing plan schema',v=>{delete v.schemaVersion;},'SCHEMA_VERSION'],
 ['unknown relay schema',v=>{v.relayProfile.schemaVersion=2;},'SCHEMA_VERSION'],
 ['fractional relay revision',v=>{v.relayProfile.revision=1.5;},'RELAY_VERSION'],
 ['nonrelay route',v=>{v.relayProfile.routingMode='direct';},'ROUTING_MODE'],
 ['missing routing mode',v=>{delete v.relayProfile.routingMode;},'ROUTING_MODE'],
 ['zero duration',v=>{v.shots[0].durationSeconds=0;},'SHOT_DURATION'],
 ['negative duration',v=>{v.shots[0].durationSeconds=-1;},'SHOT_DURATION'],
 ['infinite duration',v=>{v.shots[0].durationSeconds=Infinity;},'SHOT_DURATION'],
 ['NaN duration',v=>{v.shots[0].durationSeconds=NaN;},'SHOT_DURATION'],
 ['string duration',v=>{v.shots[0].durationSeconds='5';},'SHOT_DURATION'],
 ['present undefined duration',v=>{v.shots[0].durationSeconds=undefined;},'SHOT_DURATION'],
 ['numeric ratio',v=>{v.shots[0].aspectRatio=1.7;},'SHOT_ASPECT_RATIO'],
 ['zero ratio side',v=>{v.shots[0].aspectRatio='0:9';},'SHOT_ASPECT_RATIO'],
 ['malformed ratio',v=>{v.shots[0].aspectRatio='16/9';},'SHOT_ASPECT_RATIO'],
 ['empty prompt',v=>{v.shots[0].prompt=' ';},'SHOT_PROMPT'],
 ['missing brief revision',v=>{delete v.briefRef.revision;},'REFERENCE'],
 ['wrong brief version',v=>{v.shots[0].briefRef.revision=2;},'BRIEF_REFERENCE'],
 ['undeclared asset',v=>{v.shots[1].assetRefs[0].id='unknown';},'ASSET_REFERENCE'],
 ['wrong asset revision',v=>{v.shots[1].assetRefs[0].revision=2;},'ASSET_REFERENCE'],
 ['duplicate asset declaration',v=>{v.assetRefs.push(copy(v.assetRefs[0]));},'DUPLICATE_REFERENCE'],
 ['duplicate shot asset',v=>{v.shots[1].assetRefs.push(copy(v.shots[1].assetRefs[0]));},'DUPLICATE_REFERENCE'],
 ['nonarray asset refs',v=>{v.assetRefs={};},'REFERENCES'],
 ['sparse asset refs',v=>{v.assetRefs=[];v.assetRefs.length=1;},'REFERENCE'],
 ['empty shots',v=>{v.shots=[];},'SHOTS'],
 ['nonobject shot',v=>{v.shots[0]=null;},'SHOT_SPEC'],
 ['invalid endpoint',v=>{v.relayProfile.endpoint='/relative';},'ENDPOINT'],
 ['nonHTTP endpoint',v=>{v.relayProfile.endpoint='file:///tmp/example';},'ENDPOINT'],
 ['present undefined endpoint',v=>{v.relayProfile.endpoint=undefined;},'ENDPOINT'],
 ['endpoint userinfo',v=>{v.relayProfile.endpoint='https://fixture-user:fixture-password@gateway.example.test/v1';},'URL_CREDENTIAL'],
 ['endpoint API key query',v=>{v.relayProfile.endpoint='https://gateway.example.test/v1?api_key=fixture-only';},'URL_CREDENTIAL'],
 ['encoded credential query name',v=>{v.relayProfile.endpoint='https://gateway.example.test/v1?%61pi_key=fixture-only';},'URL_CREDENTIAL'],
 ['token in fragment',v=>{v.relayProfile.endpoint='https://gateway.example.test/v1#access_token=fixture-only';},'URL_CREDENTIAL'],
 ['secret field',v=>{v.relayProfile.apiKey='fixture-only';},'RELAY_PROFILE'],
 ['numeric model reference',v=>{v.relayProfile.modelRef=1;},'RELAY_REFERENCE'],
 ['empty price reference',v=>{v.relayProfile.pricingRef='';},'RELAY_REFERENCE'],
 ['nonarray capability',v=>{v.relayProfile.capabilities='video';},'CAPABILITIES'],
 ['duplicate capability',v=>{v.relayProfile.capabilities=['video','video'];},'CAPABILITIES'],
 ['sparse capability',v=>{v.relayProfile.capabilities=[];v.relayProfile.capabilities.length=1;},'CAPABILITIES'],
 ['injected execution permission',v=>{v.generationPermitted=true;},'VIDEO_PLAN'],
];
for(const [name,change,code]of invalid)test(`rejects ${name}`,()=>{const value=plan();change(value);assert.throws(()=>validateVideoPlan(value),{code});assert.throws(()=>inspectVideoReadiness(value),{code});});

test('offline module imports only core utilities and declares no I/O execution path',async()=>{
 const source=await readFile(new URL('../video-contracts.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/^import /gm)??[]).length,1);assert.match(source,/import \{requireThat,copy,digest\} from '\.\/core\.mjs'/);
 assert.doesNotMatch(source,/\b(?:fetch|spawn|exec|readFile|readFileSync|writeFile)\s*\(|process\.env|node:child_process|\bimport\s*\(/);
});

function declaredReview(value=fixture){return {schemaVersion:1,subjectPlanHash:validateVideoPlan(value).planHash,status:'pass',reviewerRef:'declared-reviewer',reviewedAt:'2026-10-06T14:36:00Z',evidenceRefs:['record:fixture-review']};}

test('legacy drafts without resolution or inputMode remain valid but incomplete',()=>{
 const value=plan();for(const shot of value.shots){delete shot.resolution;delete shot.inputMode;}
 assert.deepEqual(validateVideoPlan(value).plan,value);const readiness=inspectVideoReadiness(value);
 assert.equal(readiness.missing.filter(x=>x.startsWith('SHOT_RESOLUTION_MISSING:')).length,3);
 assert.equal(readiness.missing.filter(x=>x.startsWith('SHOT_INPUT_MODE_MISSING:')).length,3);
 assert.ok(readiness.missing.includes('REVIEW_MISSING'));assert.equal(readiness.generationPermitted,false);
});
test('resolution and logical input modes never assert provider capability',()=>{
 for(const inputMode of ['text-to-video','image-to-video','start-end-frames','reference-media']){
  const value=plan();Object.assign(value.shots[0],{resolution:{width:768,height:432},inputMode});
  assert.deepEqual(validateVideoPlan(value).plan.shots[0].resolution,{width:768,height:432});
  const ready=inspectVideoReadiness(value);assert.ok(ready.missing.includes('CAPABILITIES_MISSING'));assert.equal(ready.liveExecutionEnabled,false);
 }
});
const invalidSpecs=[
 ['zero width',{width:0,height:1080},'SHOT_RESOLUTION'],['negative height',{width:1920,height:-1},'SHOT_RESOLUTION'],
 ['fractional width',{width:1.5,height:1080},'SHOT_RESOLUTION'],['string width',{width:'1920',height:1080},'SHOT_RESOLUTION'],
 ['unsafe width',{width:Number.MAX_SAFE_INTEGER+1,height:1080},'SHOT_RESOLUTION'],['missing height',{width:1920},'SHOT_RESOLUTION'],
 ['extra resolution field',{width:1920,height:1080,approved:true},'SHOT_RESOLUTION'],['resolution string','1080p','SHOT_RESOLUTION'],
 ['present undefined resolution',undefined,'SHOT_RESOLUTION'],
];
for(const [label,resolution,code]of invalidSpecs)test(`rejects ${label}`,()=>{const value=plan();value.shots[0].resolution=resolution;assert.throws(()=>validateVideoPlan(value),{code});});
for(const inputMode of ['MiniMax-H3','automatic','',true,undefined])test(`rejects invalid logical inputMode ${String(inputMode)}`,()=>{const value=plan();value.shots[0].inputMode=inputMode;assert.throws(()=>validateVideoPlan(value),{code:'SHOT_INPUT_MODE'});});

test('a matching declared pass stays unverified and cannot substitute for execution approval',()=>{
 const value=freeze(plan()),review=freeze(declaredReview(value)),checked=validateVideoReviewRecord(review,value);
 assert.equal(checked.planHash,review.subjectPlanHash);assert.equal(checked.reviewHash,digest(review));assert.deepEqual(checked.review,review);
 const ready=inspectVideoReadiness(value,review,{approved:true,budgetApproved:true,reviewVerified:true});
 assert.equal(ready.review.state,'unverified');assert.equal(ready.review.status,'pass');assert.ok(ready.missing.includes('REVIEW_UNVERIFIED'));
 assert.ok(ready.missing.includes('APPROVAL_MISSING'));assert.ok(ready.missing.includes('BUDGET_MISSING'));
 assert.deepEqual(ready.executionApproval,{status:'missing',independentOfReview:true});assert.equal(ready.executionBlocker,'OFFLINE_MODULE');assert.equal(ready.generationPermitted,false);assert.equal(ready.liveExecutionEnabled,false);
});
for(const status of ['revise','blocked'])test(`declared ${status} adds a review gap without execution permission`,()=>{
 const review={...declaredReview(),status};assert.equal(validateVideoReviewRecord(review,fixture).review.status,status);
 const ready=inspectVideoReadiness(fixture,review);assert.ok(ready.missing.includes('REVIEW_NOT_PASSED'));assert.equal(ready.generationPermitted,false);
});
const changes=[
 ['prompt',v=>{v.shots[0].prompt+=' Changed.';}],['shot revision',v=>{v.shots[0].revision++;}],
 ['resolution',v=>{v.shots[0].resolution={width:1920,height:1080};}],['input mode',v=>{v.shots[0].inputMode='image-to-video';}],
 ['profile revision',v=>{v.relayProfile.revision++;}],['profile endpoint',v=>{v.relayProfile.endpoint='https://relay.example.test/changed';}],
 ['profile model reference',v=>{v.relayProfile.modelRef='changed-route';}],
];
for(const [label,change]of changes)test(`old review becomes stale after ${label} changes`,()=>{
 const value=plan(),review=declaredReview(value);change(value);
 assert.throws(()=>validateVideoReviewRecord(review,value),{code:'STALE_VIDEO_REVIEW'});
 const ready=inspectVideoReadiness(value,review);assert.equal(ready.review.state,'stale');assert.ok(ready.missing.includes('REVIEW_STALE'));assert.equal(ready.generationPermitted,false);
});
const badReviews=[
 ['schema',r=>{r.schemaVersion=2;},'REVIEW_SCHEMA_VERSION'],['hash length',r=>{r.subjectPlanHash='abc';},'REVIEW_HASH'],
 ['hash alphabet',r=>{r.subjectPlanHash='z'.repeat(64);},'REVIEW_HASH'],['approved status',r=>{r.status='approved';},'REVIEW_STATUS'],
 ['boolean status',r=>{r.status=true;},'REVIEW_STATUS'],['empty reviewer',r=>{r.reviewerRef=' ';},'REVIEWER_REFERENCE'],
 ['numeric reviewer',r=>{r.reviewerRef=1;},'REVIEWER_REFERENCE'],['date-only time',r=>{r.reviewedAt='2026-10-06';},'REVIEW_TIME'],
 ['impossible date',r=>{r.reviewedAt='2026-02-30T00:00:00Z';},'REVIEW_TIME'],['bad time hour',r=>{r.reviewedAt='2026-10-06T24:00:00Z';},'REVIEW_TIME'],
 ['bad timezone',r=>{r.reviewedAt='2026-10-06T14:36:00+25:00';},'REVIEW_TIME'],['numeric time',r=>{r.reviewedAt=1790000000;},'REVIEW_TIME'],
 ['empty evidence',r=>{r.evidenceRefs=[];},'REVIEW_EVIDENCE'],['blank evidence',r=>{r.evidenceRefs=[' '];},'REVIEW_EVIDENCE'],
 ['duplicate evidence',r=>{r.evidenceRefs=['same','same'];},'REVIEW_EVIDENCE'],['nonstring evidence',r=>{r.evidenceRefs=[{}];},'REVIEW_EVIDENCE'],
 ['sparse evidence',r=>{r.evidenceRefs=[];r.evidenceRefs.length=1;},'REVIEW_EVIDENCE'],
 ['injected approval',r=>{r.approved=true;},'REVIEW_RECORD'],['injected budget',r=>{r.budgetApproved=true;},'REVIEW_RECORD'],
 ['injected verification',r=>{r.verified=true;},'REVIEW_RECORD'],
];
for(const [label,change,code]of badReviews)test(`malformed review rejects ${label}`,()=>{
 const review=declaredReview();change(review);assert.throws(()=>validateVideoReviewRecord(review,fixture),{code});
 const ready=inspectVideoReadiness(fixture,review);assert.equal(ready.review.state,'invalid');assert.ok(ready.missing.includes('REVIEW_INVALID'));assert.equal(ready.generationPermitted,false);
});
test('review timestamps support UTC fractions and offsets without claiming actual verification',()=>{
 for(const reviewedAt of ['2024-02-29T23:59:59.123Z','2026-10-06T22:36:00+08:00','2026-10-06T09:06:00-05:30']){
  const review={...declaredReview(),reviewedAt};assert.equal(validateVideoReviewRecord(review,fixture).review.reviewedAt,reviewedAt);assert.equal(inspectVideoReadiness(fixture,review).review.state,'unverified');
 }
});
test('review records remain outside the plan and do not mutate its hash or caller data',()=>{
 const value=plan(),review=declaredReview(value),before=copy(review),hashBefore=validateVideoPlan(value).planHash;
 const result=validateVideoReviewRecord(freeze(review),freeze(value));result.review.evidenceRefs.push('local-change');result.review.reviewerRef='other';
 assert.deepEqual(review,before);assert.equal(validateVideoPlan(value).planHash,hashBefore);
 const embedded=plan();embedded.review=declaredReview(embedded);assert.throws(()=>validateVideoPlan(embedded),{code:'VIDEO_PLAN'});
});
