/** Diagnose loopback and run the complete pi-ai provider suite, without filtering/skipping tests. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export const proxyNames=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','NODE_USE_ENV_PROXY'];
export function providerTestEnv(source){
  const env={...source};
  for(const k of Object.keys(env))if(proxyNames.includes(k)||/KEY|PASSWORD|SECRET|TOKEN/i.test(k))delete env[k];
  // Node samples built-in proxy flags at process start, before Vitest setupFiles can clear them.
  if(env.NODE_OPTIONS)env.NODE_OPTIONS=env.NODE_OPTIONS.replace(/(?:^|\s)--use-env-proxy(?=\s|$)/g,' ').trim();
  return env;
}
async function run(args,env){
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});
  return {code,stdout,stderr};
}
async function loopback(){
  const server=createServer((_request,response)=>{response.setHeader('content-type','application/json');response.end('{"fixture":true}');});
  const report={node:process.version,platform:process.platform,host:'127.0.0.1',status:'not_started'};
  const started=Date.now();
  try{
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
    const response=await fetch('http://127.0.0.1:'+server.address().port,{signal:AbortSignal.timeout(5000)});
    const value=await response.json();report.httpStatus=response.status;report.status=response.status===200&&value.fixture===true?'passed':'failed';
  }catch(error){report.status='failed';report.code=error.cause?.code??error.code??error.name;}
  finally{server.closeAllConnections();await new Promise(done=>server.close(done));report.durationMs=Date.now()-started;}
  return report;
}
export async function providerRegression(directory){
  await mkdir(directory,{recursive:true,mode:0o700});
  const env=providerTestEnv(process.env);
  const report={node:process.version,platform:process.platform,proxyVariablesPresent:proxyNames.filter(k=>Boolean(process.env[k])),
    proxyValuesLogged:false,launchEnvironmentIsolated:true,previousCloudFailureReproduced:false,
    testScope:'packages/llm/llm-pi-ai/tests; all tests; no name filter',testExitCode:null};
  if(!process.versions.node.startsWith('24.'))throw Error('NODE24_REQUIRED');
  const connectivity=await run([fileURLToPath(import.meta.url),'--loopback'],env);
  try{report.loopback=JSON.parse(connectivity.stdout);}catch{report.loopback={status:'failed',code:'LOOPBACK_PROCESS_FAILED'};}
  if(report.loopback.status!=='passed')report.status='loopback_blocked';
  else{
    const jsonPath=join(directory,'provider.json');
    const tests=await run(['node_modules/vitest/vitest.mjs','run','packages/llm/llm-pi-ai/tests','--maxWorkers=2','--reporter=json','--outputFile='+jsonPath],env);
    report.testExitCode=tests.code;await writeFile(join(directory,'provider.log'),tests.stdout+tests.stderr,{mode:0o600});
    try{
      const value=JSON.parse(await readFile(jsonPath,'utf8'));
      report.tests={total:value.numTotalTests,passed:value.numPassedTests,failed:value.numFailedTests,skipped:value.numPendingTests};
      report.failures=value.testResults.flatMap(f=>f.assertionResults.filter(t=>t.status==='failed').map(t=>({file:f.name.replace(root,''),name:t.fullName,messages:t.failureMessages})));
      report.status=tests.code===0&&value.numFailedTests===0&&value.numTotalTests>0?'passed':'failed';
    }catch{report.status='test_runner_failed';}
  }
  await writeFile(join(directory,'diagnostic.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const report=process.argv[2]==='--loopback'?await loopback():await providerRegression(resolve(process.argv[2]??'.artifacts/provider-regression'));
    console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='passed'?0:2;
  }catch(error){console.error(JSON.stringify({status:'diagnostic_failed',code:error.code??'TEST_LAUNCH_ERROR'}));process.exitCode=2;}
}
