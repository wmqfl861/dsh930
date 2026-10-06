import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const script=fileURLToPath(new URL('../luna-controlled.mjs',import.meta.url));
function run(directory){
 const env={...process.env};delete env.ALPHA_SMOKE_API_KEY;delete env.ALPHA_SMOKE_ALLOW_LIVE;
 return spawnSync(process.execPath,[script,directory],{env,encoding:'utf8',timeout:10000});
}
test('an existing report directory is refused before any request or overwrite',async t=>{
 const root=await mkdtemp(join(tmpdir(),'luna-preserve-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const report=join(root,'controlled-report.json');await writeFile(report,'previous real HTTP404 evidence');
 await mkdir(join(root,'private'));
 const result=run(root);assert.equal(result.status,2);
 assert.equal(JSON.parse(result.stderr).reason,'OUTPUT_DIRECTORY_EXISTS');
 assert.equal(await readFile(report,'utf8'),'previous real HTTP404 evidence');
});
test('a fresh directory records credential absence with no inference',async t=>{
 const root=await mkdtemp(join(tmpdir(),'luna-new-report-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'nested','run');const result=run(directory);assert.equal(result.status,2);
 const report=JSON.parse(await readFile(join(directory,'controlled-report.json'),'utf8'));
 assert.equal(report.status,'credential_required');assert.equal(report.inferenceRequests,0);
 assert.equal(report.successfulInferenceRequests,0);
});
