/** Durable admission for explicitly identified generated-team invocations. */
import {mkdir,lstat,open,readFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AlphaError,copy,digest,object,requireThat} from './core.mjs';

async function syncDirectory(directory) {
  // Windows does not expose directory fsync through Node's file handles.
  if(process.platform==='win32')return;
  const handle=await open(directory,'r');
  try {await handle.sync();} finally {await handle.close();}
}
async function replaceRecord(file,record,directory) {
  const temporary=file+'.'+randomUUID()+'.tmp';
  const handle=await open(temporary,'wx',0o600);
  try {await handle.writeFile(JSON.stringify(record)+'\n');await handle.sync();} finally {await handle.close();}
  await rename(temporary,file);
  await syncDirectory(directory);
}

/**
 * Reserve before dispatch and replay only a verified completed invocation.
 * Existing incomplete, failed or unreadable records never authorize another run.
 * This is invocation deduplication, not exactly-once external provider execution.
 * @param {object} options Stable caller ID, immutable fingerprint, private directory and execution callback.
 * @returns {Promise<object>} The original completed result, or the newly completed result.
 */
export async function executeGeneratedInvocation({operationId,fingerprint,directory,execute}) {
  requireThat(typeof operationId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(operationId),'OPERATION_ID','Provide a stable operationId of 1–128 letters, numbers, underscores or hyphens; retries must reuse it');
  const location=resolve(directory);
  await mkdir(location,{recursive:true,mode:0o700});
  requireThat(!(await lstat(location)).isSymbolicLink(),'STATE_SYMLINK','State directory cannot be a symlink');
  const file=join(location,'operation-'+digest(operationId)+'.operation');
  let handle;
  try {handle=await open(file,'wx',0o600);} catch(error) {
    if(error.code!=='EEXIST')throw error;
    requireThat(!(await lstat(file)).isSymbolicLink(),'OPERATION_UNKNOWN','Invocation record is not a regular owned record');
    let prior;
    try {prior=JSON.parse(await readFile(file,'utf8'));} catch {throw new AlphaError('OPERATION_UNKNOWN','Invocation record is incomplete or unreadable; no automatic rerun is permitted');}
    requireThat(object(prior)&&prior.schemaVersion===1&&prior.operationId===operationId,'OPERATION_UNKNOWN','Unrecognized invocation record; no automatic rerun is permitted');
    requireThat(prior.fingerprint===fingerprint,'OPERATION_MISMATCH','operationId was already reserved for different blueprint, inputs or configuration');
    requireThat(prior.status==='completed','OPERATION_UNRESOLVED','Invocation is running, failed or has an unknown outcome; inspect it before deliberately choosing a new operationId');
    requireThat(object(prior.result)&&prior.resultHash===digest(prior.result)&&prior.result.invocation?.operationId===operationId&&prior.result.invocation?.fingerprint===fingerprint,'OPERATION_UNKNOWN','Completed invocation result is damaged; no automatic rerun is permitted');
    return copy(prior.result);
  }
  const reservation={schemaVersion:1,operationId,fingerprint,status:'reserved',reservedAt:new Date().toISOString()};
  // A partial reservation intentionally blocks reuse if a write or fsync fails.
  try {await handle.writeFile(JSON.stringify(reservation)+'\n');await handle.sync();} finally {await handle.close();}
  await syncDirectory(location);
  let result;
  try {result=await execute({operationId,fingerprint});} catch(error) {
    // Keep the original failure even if its diagnostic update cannot be persisted.
    try {await replaceRecord(file,{...reservation,status:'failed'},location);} catch(_error) { /* The original reserved record still forbids rerun. */ }
    throw error;
  }
  // An uncertain completion write is not repaired by invoking the provider again.
  await replaceRecord(file,{...reservation,status:'completed',result:copy(result),resultHash:digest(result)},location);
  return copy(result);
}
