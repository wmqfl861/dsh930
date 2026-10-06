/** Launches the supported DSH headless profile; never replaces the target Luna provider. */
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {configureLuna} from './luna-smoke.mjs';
import {liveBudgetFromEnv} from './luna-budget.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function nativeLunaProbe(settings,{fixture=false,budgetConfig,outputDirectory}={}){
  if(!process.versions.node.startsWith('24.'))throw Error('NODE24_REQUIRED');
  if(!fixture&&(!budgetConfig||!process.env.ALPHA_SMOKE_API_KEY||process.env.ALPHA_SMOKE_ALLOW_LIVE!=='1'))throw Error('LIVE_CREDENTIAL_AND_BUDGET_REQUIRED');
  const tmp=await mkdtemp(join(tmpdir(),'luna-native-'));
  const reportPath=join(tmp,'native-report.json');
  let child;
  try{
    const setup=await configureLuna(join(tmp,'config'),settings);
    const overlay=JSON.parse(await readFile(setup.overlayPath,'utf8')).filter(x=>!x.insert);
    overlay.find(x=>x.id==='agent-default-model').config={provider:'alpha-probe-controller',model:'controller'};
    overlay.push({insert:[{id:'luna-native-probe',name:join(root,'alpha/luna-native-plugin.mjs')}]});
    const patch=join(tmp,'overlay.json');await writeFile(patch,JSON.stringify(overlay),{mode:0o600});
    const configPath=join(tmp,'guard.json');
    await writeFile(configPath,JSON.stringify({settings,fixture,report:reportPath,nonce:'NATIVE_'+randomUUID().replaceAll('-',''),
      budget:budgetConfig??{maxRequests:2,maxUsd:0.25,inputRate:0,outputRate:1}}),{mode:0o600});
    const env={...process.env,DSH_HOME:join(tmp,'home'),DSH_AGENTS_HOME:join(tmp,'agents'),
      DSH_TELEMETRY_DISABLED:'1',DSH_TOOLS_MODE:'native',ALPHA_LUNA_GUARD_CONFIG:configPath};
    // Preserve approved proxy/CA configuration for live TLS, never disable verification.
    if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('TLS_VERIFICATION_REQUIRED');
    for(const k of Object.keys(env))if(/KEY|PASSWORD|SECRET|TOKEN/i.test(k)&&k!=='ALPHA_SMOKE_API_KEY')delete env[k];
    if(fixture)env.ALPHA_SMOKE_API_KEY='fixture-only';
    child=spawn(process.execPath,['--import',join(root,'alpha/luna-wire-guard.mjs'),'--import','tsx/esm','apps/cli/src/bin.ts',
      '--profile','headless','--patch',patch,'Run the bounded native Luna diagnostic'],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
    // Deliberately do not persist raw profile logs: providers may echo sensitive response bodies.
    let logBytes=0;const consume=b=>{logBytes+=b.length;if(logBytes>4*1024*1024)stop();};
    child.stdout.on('data',consume);child.stderr.on('data',consume);
    function stop(){if(child?.pid){try{process.kill(-child.pid,'SIGKILL');}catch{ /* already stopped */ }}}
    const timer=setTimeout(stop,210000);
    const outcome=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}));}).finally(()=>clearTimeout(timer));
    let report;
    try{report=JSON.parse(await readFile(reportPath,'utf8'));}catch{report={verified:false,status:'native_process_failed',inferenceRequests:null};}
    report.process=outcome;report.rawLogsPersisted=false;
    if(outputDirectory){await mkdir(outputDirectory,{recursive:true,mode:0o700});await writeFile(join(outputDirectory,'native-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});}
    return report;
  }finally{if(child?.pid&&child.exitCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{ /* already stopped */ }}await rm(tmp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const fixture=process.argv.includes('--fixture');
  const directory=resolve(process.argv.find((x,i)=>i>1&&!x.startsWith('--'))??'.artifacts/luna-native');
  try{
    const budget=liveBudgetFromEnv(process.env,2);
    if(!fixture&&(!process.env.ALPHA_SMOKE_API_KEY||!budget.ready))throw Error('LIVE_CREDENTIAL_AND_BUDGET_REQUIRED');
    const b=budget.ready?budget.report():undefined;
    const report=await nativeLunaProbe(JSON.parse(await readFile(new URL('luna.gateway.json',import.meta.url),'utf8')),{fixture,outputDirectory:directory,
      ...(b?{budgetConfig:{maxUsd:b.maxUsd,inputRate:b.inputUsdPerMillion,outputRate:b.outputUsdPerMillion}}:{})});
    console.log(JSON.stringify(report,null,2));process.exitCode=report.verified&&report.process.code===0?0:2;
  }catch(error){console.error(JSON.stringify({status:'blocked',reason:/^[A-Z_]+$/.test(error.message)?error.message:'NATIVE_PROBE_ERROR',inferenceRequests:0}));process.exitCode=2;}
}
