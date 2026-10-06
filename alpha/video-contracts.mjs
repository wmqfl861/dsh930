/** Offline video-plan data contracts. Validation and readiness inspection never authorize generation. */
import {requireThat,copy,digest} from './core.mjs';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const id=value=>nonempty(value)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const version=value=>Number.isSafeInteger(value)&&value>0;
function fields(value,allowed,code){requireThat(record(value)&&Object.keys(value).every(key=>allowed.includes(key)),code,'Unexpected or invalid contract fields');}
function reference(value){
 fields(value,['id','revision'],'REFERENCE');
 requireThat(id(value.id)&&version(value.revision),'REFERENCE','References require an id and a positive integer revision');
 return `${value.id}@${value.revision}`;
}
function references(values){
 requireThat(Array.isArray(values),'REFERENCES','References must be an array');
 const keys=Array.from(values,reference);requireThat(new Set(keys).size===keys.length,'DUPLICATE_REFERENCE','Duplicate versioned reference');return new Set(keys);
}
function endpoint(value){
 requireThat(typeof value==='string'&&value===value.trim(),'ENDPOINT','Endpoint must be an absolute HTTP(S) URL');
 let url;try{url=new URL(value);}catch{requireThat(false,'ENDPOINT','Endpoint must be an absolute HTTP(S) URL');}
 requireThat(['https:','http:'].includes(url.protocol),'ENDPOINT','Endpoint must use HTTP(S)');
 requireThat(!url.username&&!url.password,'URL_CREDENTIAL','Credentials must not appear in endpoint URLs');
 const credentialNames=new Set(['key','apikey','token','accesstoken','refreshtoken','authorization','auth','credential','credentials','idtoken','sessiontoken','securitytoken','xamzsecuritytoken','password','secret','clientsecret','signature','xamzcredential','xamzsignature','xgoogcredential','xgoogsignature']);
 for(const params of [url.searchParams,new URLSearchParams(url.hash.slice(1))]){
  for(const key of params.keys())requireThat(!credentialNames.has(key.toLowerCase().replace(/[-_.]/g,'')),'URL_CREDENTIAL','Credential parameters must not appear in endpoint URLs');
 }
}
function relay(profile){
 fields(profile,['schemaVersion','id','revision','routingMode','endpoint','modelRef','capabilities','pricingRef'],'RELAY_PROFILE');
 requireThat(profile.schemaVersion===1,'SCHEMA_VERSION','Unsupported relay-profile schema version');
 requireThat(id(profile.id)&&version(profile.revision),'RELAY_VERSION','Relay profile requires an id and positive integer revision');
 requireThat(profile.routingMode==='relay-only','ROUTING_MODE','Video plans must retain explicit relay-only routing');
 if(Object.hasOwn(profile,'endpoint')&&profile.endpoint!==null)endpoint(profile.endpoint);
 for(const key of ['modelRef','pricingRef'])if(Object.hasOwn(profile,key)&&profile[key]!==null)requireThat(nonempty(profile[key]),'RELAY_REFERENCE','Configured model and pricing references must be nonempty strings');
 if(Object.hasOwn(profile,'capabilities')&&profile.capabilities!==null){
  requireThat(Array.isArray(profile.capabilities)&&Array.from(profile.capabilities).every(nonempty),'CAPABILITIES','Capability declarations must be nonempty strings in an array');
  requireThat(new Set(profile.capabilities).size===profile.capabilities.length,'CAPABILITIES','Duplicate capability declaration');
 }
}
function shot(value,brief,assets){
 fields(value,['id','revision','briefRef','sequence','prompt','assetRefs','durationSeconds','aspectRatio'],'SHOT_SPEC');
 requireThat(id(value.id)&&version(value.revision),'SHOT_VERSION','Shot requires an id and positive integer revision');
 requireThat(reference(value.briefRef)===brief,'BRIEF_REFERENCE','Shot brief reference must match the exact declared brief revision');
 requireThat(Number.isSafeInteger(value.sequence)&&value.sequence>0,'SHOT_SEQUENCE','Shot sequence must be a positive integer');
 requireThat(nonempty(value.prompt),'SHOT_PROMPT','Shot prompt must be nonempty text');
 for(const asset of references(value.assetRefs))requireThat(assets.has(asset),'ASSET_REFERENCE','Shot references an undeclared asset revision');
 if(Object.hasOwn(value,'durationSeconds')&&value.durationSeconds!==null)requireThat(typeof value.durationSeconds==='number'&&Number.isFinite(value.durationSeconds)&&value.durationSeconds>0,'SHOT_DURATION','Specified duration must be a positive finite number');
 if(Object.hasOwn(value,'aspectRatio')&&value.aspectRatio!==null){
  requireThat(typeof value.aspectRatio==='string'&&/^[1-9]\d*:[1-9]\d*$/.test(value.aspectRatio)&&value.aspectRatio.split(':').every(part=>Number.isSafeInteger(Number(part))),'SHOT_ASPECT_RATIO','Specified aspect ratio must be positive integer width:height');
 }
}

/**
 * Validate one schema-v1 plan and return a detached copy plus a canonical content hash.
 * briefRef and assetRefs declare versioned inputs; every shot must use those exact
 * revisions. Shot sequences are positive, unique and increasing (gaps are allowed).
 * Relay connection fields and shot duration/aspect ratio may be omitted or null
 * in drafts; supplied values are checked without filling defaults. URL checks
 * reject user-info and credential-named query/fragment parameters, not arbitrary
 * hosts or benign query parameters. This cannot detect secrets disguised as prose.
 */
export function validateVideoPlan(plan){
 fields(plan,['schemaVersion','briefRef','assetRefs','relayProfile','shots'],'VIDEO_PLAN');
 requireThat(plan.schemaVersion===1,'SCHEMA_VERSION','Unsupported video-plan schema version');
 const brief=reference(plan.briefRef),assets=references(plan.assetRefs);relay(plan.relayProfile);
 requireThat(Array.isArray(plan.shots)&&plan.shots.length>0,'SHOTS','Plan requires at least one shot');
 const ids=new Set(),sequences=new Set();let previous=0;
 for(const value of plan.shots){
  shot(value,brief,assets);
  requireThat(!ids.has(value.id),'DUPLICATE_SHOT','Duplicate shot identity');ids.add(value.id);
  requireThat(!sequences.has(value.sequence),'DUPLICATE_SEQUENCE','Duplicate shot sequence');sequences.add(value.sequence);
  requireThat(value.sequence>previous,'SHOT_SEQUENCE','Shots must be ordered by increasing sequence');previous=value.sequence;
 }
 const detached=copy(plan);return {plan:detached,planHash:digest(detached)};
}

/**
 * List missing offline inputs and confirmations, never grant generation permission.
 * A modelRef, capability list or pricingRef is only a declaration: this module has
 * no resolver, provider probe, verified rate, spending budget or approval service.
 * It accepts no caller boolean that could turn those declarations into permission.
 * Hashes bind the exact supplied profile and shots, including their revisions.
 */
export function inspectVideoReadiness(plan){
 const checked=validateVideoPlan(plan),profile=checked.plan.relayProfile;
 const missing=[];
 if(profile.endpoint===undefined||profile.endpoint===null)missing.push('ENDPOINT_MISSING');
 missing.push(profile.modelRef?'MODEL_MAPPING_UNCONFIRMED':'MODEL_MAPPING_MISSING');
 missing.push(profile.capabilities?.length?'CAPABILITIES_UNCONFIRMED':'CAPABILITIES_MISSING');
 missing.push(profile.pricingRef?'RATE_UNCONFIRMED':'RATE_MISSING','BUDGET_MISSING','APPROVAL_MISSING');
 for(const value of checked.plan.shots){
  if(value.durationSeconds===undefined||value.durationSeconds===null)missing.push(`SHOT_DURATION_MISSING:${value.id}`);
  if(value.aspectRatio===undefined||value.aspectRatio===null)missing.push(`SHOT_ASPECT_RATIO_MISSING:${value.id}`);
 }
 return {schemaValid:true,planHash:checked.planHash,relayProfileHash:digest(profile),shotsHash:digest(checked.plan.shots),
  readiness:'blocked',missing,executionBlocker:'OFFLINE_MODULE',generationPermitted:false,liveExecutionEnabled:false};
}
