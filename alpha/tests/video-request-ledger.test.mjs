import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {VideoRequestLedger} from '../video-request-ledger.mjs';
import {copy,digest} from '../core.mjs';
import {validateVideoPlan} from '../video-contracts.mjs';
const fixture=JSON.parse(await fs.readFile(new URL('../evals/video-contract.fixture.json',import.meta.url),'utf8'));
const moduleUrl=new URL('../video-request-ledger.mjs',import.meta.url).href;
const cap={currency:'TEST-UNITS',limitUnits:10};
function input(jobId='job-1',attemptId='attempt-1'){
 const plan=copy(fixture);return {jobId,attemptId,operation:'generate-shot',plan,shotId:plan.shots[0].id,reviewRecord:null,
  quote:{schemaVersion:1,priceVersion:'explicit-fixture-v1',currency:cap.currency,estimatedUnits:6}};
}
function review(plan){return {schemaVersion:1,subjectPlanHash:validateVideoPlan(plan).planHash,status:'pass',reviewerRef:'fixture-reviewer',reviewedAt:'2026-10-06T00:00:00Z',evidenceRefs:['fixture-review']};}
async function setup(t){const directory=await fs.mkdtemp(join(tmpdir(),'dsh-video-ledger-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,ledger:new VideoRequestLedger(directory,cap)};}
const rejects=(promise,code)=>assert.rejects(promise,{code});
const evidence={kind:'confirmed-pre-submit',reference:'fixture-not-submitted'};
async function envelope(directory){return JSON.parse(await fs.readFile(join(directory,'ledger.json'),'utf8'));}
function assertOff(value){assert.equal(value.mode,'offline-fixture');assert.equal(value.generationPermitted,false);assert.equal(value.liveExecutionEnabled,false);}

test('reopen preserves one reservation, exact bindings and unknown actual usage',async t=>{
 const {directory,ledger}=await setup(t),value=input();value.reviewRecord=review(value.plan);const before=copy(value);
 const first=await ledger.reserve(value);assertOff(first);assert.equal(first.disposition,'reserved');assert.deepEqual(value,before);
 const record=first.record,entry=record.requests[0];assert.equal(entry.planHash,digest(value.plan));assert.equal(entry.reviewHash,digest(value.reviewRecord));assert.equal(entry.profileHash,digest(value.plan.relayProfile));assert.equal(entry.shotHash,digest(value.plan.shots[0]));
 first.record.requests[0].request.plan.shots[0].prompt='caller mutation';
 const restored=await new VideoRequestLedger(directory,cap).snapshot();assertOff(restored);assert.equal(restored.reservedUnits,6);assert.equal(restored.settledUnits,0);assert.deepEqual(restored.actualUsage,{status:'unknown',units:null});assert.equal(restored.records[0].requests[0].request.plan.shots[0].prompt,before.plan.shots[0].prompt);
 assert.equal((await ledger.reserve(before)).disposition,'existing');assert.equal((await ledger.snapshot()).records.length,1);
});

test('intent fingerprint excludes job, attempt, quote amount, quote version and review metadata',async t=>{
 const {ledger}=await setup(t),a=input();a.reviewRecord=review(a.plan);await ledger.reserve(a);
 const b=input('job-2','attempt-2');b.quote.estimatedUnits=0;b.quote.priceVersion='changed-quote';b.reviewRecord={...review(b.plan),reviewerRef:'new-declaration'};
 const result=await ledger.reserve(b);assert.equal(result.disposition,'deduplicated');assert.equal(result.record.requests.length,2);assert.equal((await ledger.snapshot()).reservedUnits,6);
 assert.equal((await ledger.reserve(b)).disposition,'existing');b.quote.estimatedUnits=1;await rejects(ledger.reserve(b),'LEDGER_JOB_CONFLICT');
});

test('caller changes after enqueue cannot alter persisted input or budget',async t=>{
 const {directory}=await setup(t),policy=copy(cap),ledger=new VideoRequestLedger(directory,policy),value=input(),pending=ledger.reserve(value);
 value.plan.shots[0].prompt='changed after queue';value.quote.estimatedUnits=0;policy.limitUnits=100;
 await pending;const snapshot=await ledger.snapshot();assert.equal(snapshot.reservedUnits,6);assert.equal(snapshot.budget.limitUnits,10);assert.equal(snapshot.records[0].requests[0].request.plan.shots[0].prompt,fixture.shots[0].prompt);
});

for(const [name,change] of [
 ['prompt',v=>{v.plan.shots[0].prompt+=' changed';}],['shot revision',v=>{v.plan.shots[0].revision++;}],
 ['profile revision',v=>{v.plan.relayProfile.revision++;}],['resolution',v=>{v.plan.shots[0].resolution={width:1280,height:720};}],
 ['input mode',v=>{v.plan.shots[0].inputMode='image-to-video';}],['attempt id',v=>{v.attemptId='different';}],
 ['review binding',v=>{v.reviewRecord=review(v.plan);}],['quote',v=>{v.quote.estimatedUnits=5;}]
])test(`same job rejects changed ${name}`,async t=>{const {ledger}=await setup(t);await ledger.reserve(input());const changed=input();change(changed);await rejects(ledger.reserve(changed),'LEDGER_JOB_CONFLICT');assert.equal((await ledger.snapshot()).reservedUnits,6);});

test('another shot or changed content is a distinct intent and cannot overspend',async t=>{
 const {ledger}=await setup(t);await ledger.reserve(input());const second=input('job-2','attempt-2');second.shotId=fixture.shots[1].id;
 await rejects(ledger.reserve(second),'LEDGER_CAP');second.quote.estimatedUnits=4;await ledger.reserve(second);assert.equal((await ledger.snapshot()).reservedUnits,10);
 const third=input('job-3','attempt-3');third.plan.shots[0].prompt+=' edited';await rejects(ledger.reserve(third),'LEDGER_CAP');
});

test('attempt identifiers cannot be reused for changed intent',async t=>{
 const {ledger}=await setup(t);await ledger.reserve(input());const second=input('job-2');second.shotId=fixture.shots[1].id;second.quote.estimatedUnits=0;await rejects(ledger.reserve(second),'LEDGER_ATTEMPT_CONFLICT');
});

test('plan hash drift invalidates a declared review before reservation',async t=>{
 const {ledger}=await setup(t),value=input();value.reviewRecord=review(value.plan);value.plan.shots[0].prompt+=' edited';assert.throws(()=>ledger.reserve(value),{code:'STALE_VIDEO_REVIEW'});assert.equal((await ledger.snapshot()).records.length,0);
});

test('possibly-submitted and unknown persist holds and reject new attempts even with another pass review',async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());await ledger.markPossiblySubmitted('job-1');
 for(const state of ['possibly-submitted','unknown']){
  if(state==='unknown')await ledger.markUnknown('job-1');const reopened=new VideoRequestLedger(directory,cap),snapshot=await reopened.snapshot();assert.equal(snapshot.records[0].state,state);assert.equal(snapshot.reservedUnits,6);assert.deepEqual(snapshot.actualUsage,{status:'unknown',units:null});
  await rejects(reopened.cancelPreSubmit('job-1',evidence),'LEDGER_CANCEL_STATE');
  const retry=input('new-job','new-attempt');retry.reviewRecord=review(retry.plan);retry.quote.estimatedUnits=0;await rejects(reopened.reserve(retry),'LEDGER_UNRESOLVED_INTENT');assert.equal((await reopened.reserve(input())).record.state,state);
 }
 await rejects(ledger.markPossiblySubmitted('job-1'),'LEDGER_TRANSITION');await ledger.markUnknown('job-1');
});

test('only pre-submit reservation cancellation releases units and never silently restarts that intent',async t=>{
 const {ledger}=await setup(t);await ledger.reserve(input());await ledger.cancelPreSubmit('job-1',evidence);assert.equal((await ledger.snapshot()).reservedUnits,0);
 const repeat=await ledger.reserve(input('job-2','attempt-2'));assert.equal(repeat.disposition,'deduplicated');assert.equal(repeat.record.state,'cancelled');assert.deepEqual(repeat.record.actualUsage,{status:'unknown',units:null});
 await rejects(ledger.markPossiblySubmitted('job-2'),'LEDGER_TRANSITION');await rejects(ledger.markUnknown('job-1'),'LEDGER_TRANSITION');await rejects(ledger.cancelPreSubmit('job-1',evidence),'LEDGER_CANCEL_STATE');
 const second=input('job-3','attempt-3');second.shotId=fixture.shots[1].id;await ledger.reserve(second);assert.equal((await ledger.snapshot()).reservedUnits,6);
});

test('per-instance transactions serialize and validation failure does not poison the queue',async t=>{
 const {ledger}=await setup(t);const results=await Promise.all([ledger.reserve(input()),ledger.reserve(input('job-2','attempt-2'))]);assert.deepEqual(results.map(r=>r.disposition),['reserved','deduplicated']);
 await rejects(ledger.markUnknown('missing'),'LEDGER_JOB_MISSING');assert.equal((await ledger.snapshot()).reservedUnits,6);
});

for(const [name,change,code] of [
 ['missing price version',v=>{delete v.quote.priceVersion;},'LEDGER_FIELDS'],['negative price',v=>{v.quote.estimatedUnits=-1;},'LEDGER_QUOTE'],
 ['fractional units',v=>{v.quote.estimatedUnits=0.5;},'LEDGER_QUOTE'],['unsafe units',v=>{v.quote.estimatedUnits=Number.MAX_SAFE_INTEGER+1;},'LEDGER_QUOTE'],
 ['missing review field',v=>{delete v.reviewRecord;},'LEDGER_FIELDS'],['invented approval',v=>{v.approved=true;},'LEDGER_FIELDS'],
 ['unknown operation',v=>{v.operation='submit-image';},'LEDGER_OPERATION'],['missing shot',v=>{v.shotId='missing';},'LEDGER_SHOT'],
 ['invalid attempt',v=>{v.attemptId='';},'LEDGER_ID'],['quote version',v=>{v.quote.schemaVersion=2;},'LEDGER_QUOTE']
])test(`invalid ${name} is rejected without a reservation`,async t=>{const {ledger}=await setup(t),value=input();change(value);assert.throws(()=>ledger.reserve(value),{code});assert.equal((await ledger.snapshot()).reservedUnits,0);});

test('currency and fixed budget cannot be changed on reopen',async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());const other=input('job-2','attempt-2');other.quote.currency='OTHER';await rejects(ledger.reserve(other),'LEDGER_CURRENCY');
 await rejects(new VideoRequestLedger(directory,{...cap,limitUnits:100}).snapshot(),'LEDGER_BUDGET_CHANGED');await rejects(ledger.snapshot(),'LEDGER_LOCKED');
});

test('safe-integer cap permits exact maximum without overflowing and blocks one more unit',async t=>{
 const {directory}=await setup(t),ledger=new VideoRequestLedger(directory,{...cap,limitUnits:Number.MAX_SAFE_INTEGER}),a=input();a.quote.estimatedUnits=Number.MAX_SAFE_INTEGER;await ledger.reserve(a);
 const b=input('job-2','attempt-2');b.shotId=fixture.shots[1].id;b.quote.estimatedUnits=1;await rejects(ledger.reserve(b),'LEDGER_CAP');assert.equal((await ledger.snapshot()).reservedUnits,Number.MAX_SAFE_INTEGER);
});

for(const [name,mutate,code] of [
 ['invalid JSON',()=>'{','LEDGER_CORRUPT'],['checksum mismatch',v=>{v.data.records=[];return JSON.stringify(v);},'LEDGER_CORRUPT'],
 ['schema version',v=>{v.data.schemaVersion=2;v.checksum=digest(v.data);return JSON.stringify(v);},'LEDGER_VERSION'],
 ['input hash drift',v=>{v.data.records[0].requests[0].request.plan.shots[0].prompt+=' drift';v.checksum=digest(v.data);return JSON.stringify(v);},'LEDGER_HASH'],
 ['fake actual zero',v=>{v.data.records[0].actualUsage={status:'known',units:0};v.checksum=digest(v.data);return JSON.stringify(v);},'LEDGER_USAGE'],
 ['execution flag',v=>{v.data.liveExecutionEnabled=true;v.checksum=digest(v.data);return JSON.stringify(v);},'LEDGER_VERSION']
])test(`reopening ${name} fails closed and retains a lock`,async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());await fs.writeFile(join(directory,'ledger.json'),mutate(await envelope(directory)));
 await rejects(new VideoRequestLedger(directory,cap).snapshot(),code);await rejects(ledger.reserve(input('job-2','attempt-2')),'LEDGER_LOCKED');
});

test('an arbitrarily old lock is never stolen or aged out',async t=>{
 const {directory,ledger}=await setup(t);const path=join(directory,'ledger.lock');await fs.writeFile(path,'stale fixture');await fs.utimes(path,new Date(0),new Date(0));await rejects(ledger.reserve(input()),'LEDGER_LOCKED');assert.equal(await fs.readFile(path,'utf8'),'stale fixture');
});

test('an unresolved temporary file cannot be ignored',async t=>{
 const {directory,ledger}=await setup(t);await fs.writeFile(join(directory,'ledger.pending'),'unfinished');await rejects(ledger.snapshot(),'LEDGER_PENDING');assert.equal(await fs.readFile(join(directory,'ledger.pending'),'utf8'),'unfinished');await rejects(ledger.snapshot(),'LEDGER_LOCKED');
});

for(const stage of ['write','sync','rename'])test(`${stage} failure reports no success and retains crash evidence`,async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());const prior=await fs.readFile(join(directory,'ledger.json'),'utf8');
 if(stage==='rename')t.mock.method(fs,'rename',async()=>{throw Object.assign(new Error('fixture rename failure'),{code:'EIO'});});
 else{const original=fs.open;t.mock.method(fs,'open',async(...args)=>{const handle=await original(...args);if(String(args[0]).endsWith('ledger.pending'))t.mock.method(handle,stage==='write'?'writeFile':'sync',async()=>{throw Object.assign(new Error('fixture write failure'),{code:'EIO'});});return handle;});}
 await rejects(ledger.markUnknown('job-1'),'EIO');t.mock.restoreAll();assert.equal(await fs.readFile(join(directory,'ledger.json'),'utf8'),prior);await fs.stat(join(directory,'ledger.pending'));await rejects(new VideoRequestLedger(directory,cap).snapshot(),'LEDGER_LOCKED');
});

// Children inherit no credentials or network configuration: these workers only use filesystem IPC.
async function child(t,directory,value,mode){
 const source=`import fs from 'node:fs/promises';import {VideoRequestLedger} from ${JSON.stringify(moduleUrl)};
 const config=JSON.parse(process.argv[1]);const messages=[];let waiter;
 process.on('message',m=>{if(waiter){const w=waiter;waiter=null;w(m);}else messages.push(m);});
 const receive=()=>messages.length?Promise.resolve(messages.shift()):new Promise(r=>{waiter=r;});
 if(config.mode==='hold'){const open=fs.open;fs.open=async(...args)=>{const h=await open(...args);if(String(args[0]).endsWith('ledger.lock')){process.send('locked');await receive();}return h;};}
 if(config.mode.startsWith('crash-')){const rename=fs.rename;fs.rename=async(...args)=>{if(config.mode==='crash-before-rename')process.exit(86);await rename(...args);process.exit(87);};}
 process.send('ready');await receive();const ledger=new VideoRequestLedger(config.directory,config.cap);
 try{const result=config.mode.startsWith('crash-')?await ledger.markUnknown('job-1'):await ledger.reserve(config.value);process.send({result});}
 catch(error){process.send({error:error.code??error.message});}process.disconnect();`;
 const worker=spawn(process.execPath,['--input-type=module','-e',source,JSON.stringify({directory,value,mode,cap})],{env:{},stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';worker.stderr.setEncoding('utf8');worker.stderr.on('data',chunk=>{stderr+=chunk;});worker.stdout.resume();
 const exited=once(worker,'exit'),messages=[],waiters=[];worker.on('message',m=>{if(waiters.length)waiters.shift()(m);else messages.push(m);});
 const next=()=>messages.length?Promise.resolve(messages.shift()):new Promise(resolve=>waiters.push(resolve));
 t.after(async()=>{if(worker.exitCode===null&&worker.signalCode===null)worker.kill();await exited;});
 assert.equal(await next(),'ready');return {worker,next,exited,stderr:()=>stderr};
}

for(const different of [false,true])test(`two real processes share ${different?'one small cap across different intents':'one reservation for duplicate intent'}`,{timeout:30000},async t=>{
 const {directory}=await setup(t),a=input(),b=input('job-2','attempt-2');if(different)b.shotId=fixture.shots[1].id;
 const first=await child(t,directory,a,'hold'),second=await child(t,directory,b,'normal');
 first.worker.send('go');assert.equal(await first.next(),'locked');second.worker.send('go');assert.deepEqual(await second.next(),{error:'LEDGER_LOCKED'});assert.deepEqual(await second.exited,[0,null]);
 first.worker.send('release');assert.equal((await first.next()).result.disposition,'reserved');assert.deepEqual(await first.exited,[0,null]);assert.equal(first.stderr()+second.stderr(),'');
 const reopened=new VideoRequestLedger(directory,cap);if(different)await rejects(reopened.reserve(b),'LEDGER_CAP');else assert.equal((await reopened.reserve(b)).disposition,'deduplicated');
 const snapshot=await reopened.snapshot();assert.equal(snapshot.records.length,1);assert.equal(snapshot.reservedUnits,6);assert.ok(snapshot.reservedUnits+snapshot.settledUnits<=cap.limitUnits);
});

for(const stage of ['before','after'])test(`process crash ${stage} unknown rename preserves lock and old-or-new complete ledger`,{timeout:30000},async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());const worker=await child(t,directory,input(),`crash-${stage}-rename`);worker.worker.send('go');assert.deepEqual(await worker.exited,[stage==='before'?86:87,null]);assert.equal(worker.stderr(),'');
 const persisted=await envelope(directory);assert.equal(persisted.checksum,digest(persisted.data));assert.equal(persisted.data.records[0].state,stage==='before'?'reserved':'unknown');assert.equal(persisted.data.records[0].requests[0].request.quote.estimatedUnits,6);
 await rejects(new VideoRequestLedger(directory,cap).snapshot(),'LEDGER_LOCKED');
});

test('completed unknown transition survives normal process exit without being converted to zero',async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());await ledger.markUnknown('job-1');const reopened=await new VideoRequestLedger(directory,cap).snapshot();assert.equal(reopened.records[0].state,'unknown');assert.equal(reopened.reservedUnits,6);assert.deepEqual(reopened.records[0].actualUsage,{status:'unknown',units:null});
});

test('module has no transport, credential access, subprocess or submission callback',async()=>{
 const text=await fs.readFile(new URL('../video-request-ledger.mjs',import.meta.url),'utf8');assert.doesNotMatch(text,/\bfetch\s*\(|node:(?:https?|net|child_process)|process\.env|API_KEY|submitCallback/);
 assert.equal(typeof VideoRequestLedger.prototype.submit,'undefined');assert.equal(typeof VideoRequestLedger.prototype.reconcile,'undefined');assert.equal(typeof VideoRequestLedger.prototype.settle,'undefined');
});

for(const [name,change] of [['quote',v=>{v.quote.estimatedUnits=0;}],['review',v=>{v.reviewRecord=review(v.plan);}]])test(`attempt id rejects changed ${name} under a new job alias`,async t=>{
 const {ledger}=await setup(t);await ledger.reserve(input());const alias=input('alias-job');change(alias);await rejects(ledger.reserve(alias),'LEDGER_ATTEMPT_CONFLICT');assert.equal((await ledger.snapshot()).reservedUnits,6);
});

test('same attempt with identical inputs allows another job alias without reserving again',async t=>{
 const {ledger}=await setup(t);await ledger.reserve(input());assert.equal((await ledger.reserve(input('alias-job'))).disposition,'deduplicated');assert.equal((await ledger.snapshot()).reservedUnits,6);
});

test('missing data after initialization fails closed instead of resetting the cap',async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());await fs.unlink(join(directory,'ledger.json'));await rejects(ledger.reserve(input('another-job','another-attempt')),'LEDGER_MISSING');await rejects(ledger.snapshot(),'LEDGER_LOCKED');
});

test('missing initialization marker cannot bless existing ledger data',async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());await fs.unlink(join(directory,'ledger.initialized'));await rejects(ledger.snapshot(),'LEDGER_CORRUPT');await rejects(ledger.snapshot(),'LEDGER_LOCKED');
});

test('directory fsync failure after rename reports uncertainty and retains the lock',async t=>{
 const {directory,ledger}=await setup(t);await ledger.reserve(input());let renamed=false;const originalRename=fs.rename,originalOpen=fs.open;
 t.mock.method(fs,'rename',async(...args)=>{await originalRename(...args);renamed=true;});
 t.mock.method(fs,'open',async(...args)=>{const handle=await originalOpen(...args);if(renamed&&String(args[0])===directory)t.mock.method(handle,'sync',async()=>{throw Object.assign(new Error('fixture directory sync failure'),{code:'EIO'});});return handle;});
 await rejects(ledger.markUnknown('job-1'),'EIO');t.mock.restoreAll();assert.equal((await envelope(directory)).data.records[0].state,'unknown');await rejects(ledger.snapshot(),'LEDGER_LOCKED');
});

test('missing shared directory is not silently replaced by a fresh budget domain',async t=>{
 const {directory}=await setup(t);await rejects(new VideoRequestLedger(join(directory,'absent'),cap).snapshot(),'ENOENT');
});

test('invalid fixed budget has no implicit cap or currency',()=>{
 for(const value of [{currency:'TEST'}, {limitUnits:10}, {...cap,limitUnits:-1}, {...cap,limitUnits:0.5}, {...cap,limitUnits:Infinity}])assert.throws(()=>new VideoRequestLedger('fixture-directory',value));
});
