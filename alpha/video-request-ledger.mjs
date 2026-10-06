/** Offline fixture accounting on one trusted shared filesystem; never submits media requests. */
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {requireThat,copy,digest,object,nonempty} from './core.mjs';
import {validateVideoPlan,validateVideoReviewRecord} from './video-contracts.mjs';

const flags={mode:'offline-fixture',generationPermitted:false,liveExecutionEnabled:false};
const units=value=>Number.isSafeInteger(value)&&value>=0;
const identifier=value=>nonempty(value)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
function fields(value,keys){requireThat(object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),'LEDGER_FIELDS','Unexpected or missing ledger fields');}
function budget(value){
 fields(value,['currency','limitUnits']);
 requireThat(identifier(value.currency)&&units(value.limitUnits),'LEDGER_BUDGET','Declare a currency and nonnegative safe-integer fixture cap');return copy(value);
}
function request(value){
 fields(value,['jobId','attemptId','operation','plan','shotId','reviewRecord','quote']);
 requireThat(identifier(value.jobId)&&identifier(value.attemptId)&&identifier(value.shotId),'LEDGER_ID','Job, attempt and shot identifiers are required');
 requireThat(value.operation==='generate-shot','LEDGER_OPERATION','Only the generate-shot logical operation is supported');
 const checked=validateVideoPlan(value.plan),shot=checked.plan.shots.find(item=>item.id===value.shotId);
 requireThat(shot,'LEDGER_SHOT','Selected shot must exist in the bound plan');
 const review=value.reviewRecord===null?null:validateVideoReviewRecord(value.reviewRecord,checked.plan);
 fields(value.quote,['schemaVersion','priceVersion','currency','estimatedUnits']);
 requireThat(value.quote.schemaVersion===1&&nonempty(value.quote.priceVersion)&&identifier(value.quote.currency)&&units(value.quote.estimatedUnits),'LEDGER_QUOTE','An explicit versioned fixture quote is required');
 const detached=copy(value),profileHash=digest(checked.plan.relayProfile),shotHash=digest(shot);
 return {request:detached,payloadHash:digest(detached),planHash:checked.planHash,reviewHash:review?.reviewHash??null,profileHash,shotHash,
  fingerprint:digest({operation:value.operation,profileHash,shotHash})};
}
const attemptPayload=value=>digest({...value,jobId:null});
function cancellation(value){
 fields(value,['kind','reference']);requireThat(value.kind==='confirmed-pre-submit'&&nonempty(value.reference),'LEDGER_CANCEL_EVIDENCE','Cancellation requires a pre-submit evidence reference');
}
function total(records){
 let held=0;for(const item of records)if(item.state!=='cancelled'){
  held+=item.requests[0].request.quote.estimatedUnits;requireThat(units(held),'LEDGER_OVERFLOW','Reserved units exceed safe-integer accounting');
 }return held;
}
function validate(value,expectedBudget){
 fields(value,['schemaVersion','mode','generationPermitted','liveExecutionEnabled','budget','records']);
 requireThat(value.schemaVersion===1&&value.mode===flags.mode&&value.generationPermitted===false&&value.liveExecutionEnabled===false,'LEDGER_VERSION','Unsupported or executable ledger');
 budget(value.budget);requireThat(digest(value.budget)===digest(expectedBudget),'LEDGER_BUDGET_CHANGED','The fixed ledger budget cannot be replaced');
 requireThat(Array.isArray(value.records),'LEDGER_RECORDS','Ledger records must be an array');
 const jobs=new Set(),attempts=new Map(),fingerprints=new Set();
 for(const item of value.records){
  fields(item,['fingerprint','requests','state','actualUsage','cancellationEvidence']);
  requireThat(!fingerprints.has(item.fingerprint),'LEDGER_DUPLICATE','Duplicate logical intent');fingerprints.add(item.fingerprint);
  requireThat(['reserved','possibly-submitted','unknown','cancelled'].includes(item.state),'LEDGER_STATE','Unknown persisted request state');
  requireThat(Array.isArray(item.requests)&&item.requests.length>0,'LEDGER_RECORDS','Each intent requires a bound request');
  fields(item.actualUsage,['status','units']);requireThat(item.actualUsage.status==='unknown'&&item.actualUsage.units===null,'LEDGER_USAGE','This offline slice cannot assert actual usage or cost');
  if(item.state==='cancelled')cancellation(item.cancellationEvidence);else requireThat(item.cancellationEvidence===null,'LEDGER_STATE','Only cancelled reservations carry cancellation evidence');
  for(const entry of item.requests){
   fields(entry,['request','payloadHash','planHash','reviewHash','profileHash','shotHash','fingerprint']);
   const checked=request(entry.request);requireThat(digest(checked)===digest(entry)&&checked.fingerprint===item.fingerprint,'LEDGER_HASH','Persisted input binding has drifted');
   requireThat(checked.request.quote.currency===value.budget.currency,'LEDGER_CURRENCY','Quote and cap currencies differ');
   requireThat(!jobs.has(checked.request.jobId),'LEDGER_DUPLICATE','Duplicate job id');jobs.add(checked.request.jobId);
   const binding=attemptPayload(checked.request),prior=attempts.get(checked.request.attemptId);
   requireThat(!prior||prior===binding,'LEDGER_ATTEMPT_CONFLICT','Attempt id belongs to another payload');attempts.set(checked.request.attemptId,binding);
  }
 }
 requireThat(total(value.records)<=value.budget.limitUnits,'LEDGER_CAP','Persisted reservations exceed the declared cap');return value;
}
function result(record,disposition){return {...flags,disposition,record:copy(record)};}

/**
 * Persistent, serial offline fixture reservations for one fixed shared directory.
 * Every cooperating process must use that same directory and immutable budget.
 * Locks fail closed immediately, including after crashes; no age-based recovery,
 * execution callback, network adapter, settlement or reconciliation is provided.
 */
export class VideoRequestLedger {
 #directory;#budget;#queue=Promise.resolve();
 constructor(directory,declaredBudget){
  requireThat(nonempty(directory),'LEDGER_DIRECTORY','Provide the fixed shared ledger directory');
  this.#directory=resolve(directory);this.#budget=budget(declaredBudget);
 }
 async #syncDirectory(){const handle=await fs.open(this.#directory,'r');try{await handle.sync();}finally{await handle.close();}}
 async #load(){
  let initialized=false;try{const marker=await fs.readFile(join(this.#directory,'ledger.initialized'),'utf8');requireThat(marker==='offline-fixture ledger v1\n','LEDGER_CORRUPT','Invalid initialization marker');initialized=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  let text;try{text=await fs.readFile(join(this.#directory,'ledger.json'),'utf8');}catch(error){
   if(error.code!=='ENOENT')throw error;
   requireThat(!initialized,'LEDGER_MISSING','An initialized ledger is missing its data; automatic reset is forbidden');
   return {schemaVersion:1,...flags,budget:copy(this.#budget),records:[]};
  }
  requireThat(initialized,'LEDGER_CORRUPT','Ledger data is missing its initialization marker');
  let envelope;try{envelope=JSON.parse(text);}catch{requireThat(false,'LEDGER_CORRUPT','Ledger JSON is unreadable');}
  fields(envelope,['data','checksum']);requireThat(digest(envelope.data)===envelope.checksum,'LEDGER_CORRUPT','Ledger checksum mismatch');return validate(envelope.data,this.#budget);
 }
 async #save(data){
  const temporary=join(this.#directory,'ledger.pending');
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify({data,checksum:digest(data)})+'\n');await handle.sync();}finally{await handle.close();}
  await fs.rename(temporary,join(this.#directory,'ledger.json'));await this.#syncDirectory();
  let marker;try{marker=await fs.open(join(this.#directory,'ledger.initialized'),'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;}
  if(marker){try{await marker.writeFile('offline-fixture ledger v1\n');await marker.sync();}finally{await marker.close();}await this.#syncDirectory();}
 }
 #transaction(action){
  const operation=this.#queue.then(async()=>{
   const directory=await fs.lstat(this.#directory);
   requireThat(directory.isDirectory()&&!directory.isSymbolicLink(),'LEDGER_DIRECTORY','The shared ledger directory must already exist and cannot be a symlink');
   let lock;try{lock=await fs.open(join(this.#directory,'ledger.lock'),'wx',0o600);}catch(error){
    if(error.code==='EEXIST')requireThat(false,'LEDGER_LOCKED','Ledger is locked; stale locks require explicit operator investigation');throw error;
   }
   let uncertain=false;
   try{
    uncertain=true;await lock.writeFile('offline-fixture ledger lock\n');await lock.sync();await this.#syncDirectory();
    // A prior temporary file must never be overwritten or treated as an empty ledger.
    try{await fs.lstat(join(this.#directory,'ledger.pending'));requireThat(false,'LEDGER_PENDING','Unresolved temporary ledger requires investigation');}catch(error){if(error.code!=='ENOENT')throw error;}
    const data=await this.#load();uncertain=false;
    const output=action(data);validate(data,this.#budget);
    uncertain=true;await this.#save(data);uncertain=false;return copy(output);
   }finally{
    await lock.close();
    // Failed reads/writes preserve the lock and pending evidence; never report success.
    if(!uncertain){await fs.unlink(join(this.#directory,'ledger.lock'));await this.#syncDirectory();}
   }
  });
  this.#queue=operation.catch(()=>{});return operation;
 }
 /** Reserve once per logical intent; repeated ids bind the exact immutable payload. */
 reserve(value){
  // Detach synchronously, before entering the async queue, to prevent caller mutation.
  const checked=request(value);
  return this.#transaction(data=>{
   requireThat(checked.request.quote.currency===data.budget.currency,'LEDGER_CURRENCY','Quote and cap currencies differ');
   for(const item of data.records){
    const job=item.requests.find(entry=>entry.request.jobId===checked.request.jobId);
    if(job){requireThat(job.payloadHash===checked.payloadHash,'LEDGER_JOB_CONFLICT','An existing job id cannot bind changed inputs');return result(item,'existing');}
    const attempt=item.requests.find(entry=>entry.request.attemptId===checked.request.attemptId);
    requireThat(!attempt||attemptPayload(attempt.request)===attemptPayload(checked.request),'LEDGER_ATTEMPT_CONFLICT','An attempt id cannot bind changed inputs');
   }
   const existing=data.records.find(item=>item.fingerprint===checked.fingerprint);
   if(existing){
    requireThat(!['possibly-submitted','unknown'].includes(existing.state),'LEDGER_UNRESOLVED_INTENT','A new job or attempt cannot replace unresolved work; reconciliation is not implemented');
    existing.requests.push(checked);return result(existing,'deduplicated');
   }
   requireThat(checked.request.quote.estimatedUnits<=data.budget.limitUnits-total(data.records),'LEDGER_CAP','Insufficient unreserved fixture units');
   const item={fingerprint:checked.fingerprint,requests:[checked],state:'reserved',actualUsage:{status:'unknown',units:null},cancellationEvidence:null};
   data.records.push(item);return result(item,'reserved');
  });
 }
 /** Persist the uncertainty marker before any future executor could submit; this method executes nothing. */
 markPossiblySubmitted(jobId){return this.#state(jobId,'possibly-submitted');}
 /** Record timeout/crash uncertainty conservatively; the entire reservation stays held. */
 markUnknown(jobId){return this.#state(jobId,'unknown');}
 #state(jobId,next){return this.#transaction(data=>{
  const item=this.#find(data,jobId);requireThat(item.state===next||item.state==='reserved'||(item.state==='possibly-submitted'&&next==='unknown'),'LEDGER_TRANSITION','This transition would reopen or retry completed/uncertain work');
  item.state=next;return result(item,'recorded');
 });}
 #find(data,jobId){
  requireThat(identifier(jobId),'LEDGER_ID','A job id is required');const item=data.records.find(record=>record.requests.some(entry=>entry.request.jobId===jobId));
  requireThat(item,'LEDGER_JOB_MISSING','No such job in this fixed ledger');return item;
 }
 /** Release only a ledger-proven, never-submitted reservation with a declared evidence reference. */
 cancelPreSubmit(jobId,evidence){
  cancellation(evidence);const detached=copy(evidence);
  return this.#transaction(data=>{
   const item=this.#find(data,jobId);requireThat(item.state==='reserved','LEDGER_CANCEL_STATE','Only a never-submitted reservation may be released');
   item.state='cancelled';item.cancellationEvidence=detached;return result(item,'cancelled');
  });
 }
 /** Return detached persisted records and fixture accounting, never actual billing totals. */
 snapshot(){return this.#transaction(data=>({...copy(data),reservedUnits:total(data.records),settledUnits:0,actualUsage:{status:'unknown',units:null}}));}
}
