/** Runs a real supported DSH profile with deterministic providers. Never claims live model quality. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTeam} from '../core.mjs';
import {fixtureConfig} from '../fixtures.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const tmp=await mkdtemp(join(tmpdir(),'dsh-alpha-native-'));
let log='';
try{
 const {team}=await loadTeam();const conf=join(tmp,'models.json');await writeFile(conf,JSON.stringify(fixtureConfig(team)));
 const patch=join(tmp,'overlay.json');await writeFile(patch,JSON.stringify([
  {id:'llm-deepseek',disabled:true},
  {insert:[{id:'alpha-native-fixture',name:join(root,'alpha/tests/native-fixture.mjs')},{id:'alpha-team',name:join(root,'alpha/dsh-plugin.mjs'),config:{modelConfigPath:conf,stateDirectory:join(tmp,'runs')}}]},
 ]));
 const env={...process.env,DSH_HOME:join(tmp,'home'),DSH_AGENTS_HOME:join(tmp,'agents'),DSH_TELEMETRY_DISABLED:'1',DSH_TOOLS_MODE:'native'};
 for(const k of Object.keys(env))if(/KEY|PASSWORD|SECRET|TOKEN/i.test(k))delete env[k];
 const child=spawn(process.execPath,['--import','tsx/esm','apps/cli/src/bin.ts','--profile','headless','--patch',patch,'Run the Alpha native fixture'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b.toString()).slice(-2000000);});
 const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timer));
 await writeFile(process.env.ALPHA_NATIVE_LOG??join(tmpdir(),'alpha-native-smoke.log'),log);
 assert.equal(result.code,0,log.slice(-10000));assert.equal(result.signal,null);assert.match(log,/ALPHA_NATIVE_FIXTURE_OK/);
 const files=(await readdir(join(tmp,'runs'))).filter(f=>f.endsWith('.json'));assert.equal(files.length,1);
 const state=JSON.parse(await readFile(join(tmp,'runs',files[0]),'utf8'));assert.equal(Object.keys(state.pairs).length,7);assert.equal(state.delegationsReserved,21);assert.equal(state.status,'awaiting_human_acceptance');
 console.log(JSON.stringify({nativeDshLifecycle:'passed',provider:'deterministic-fixture',logicalActors:14,delegations:21,pairs:7,paidModelCalls:0,realModelQualityEvaluated:false}));
}finally{await rm(tmp,{recursive:true,force:true});}
