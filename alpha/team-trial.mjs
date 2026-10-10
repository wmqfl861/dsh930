/** Launch one explicitly labelled same-model trial through the supported DSH headless profile. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {configureLuna} from './luna-smoke.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function runTeamTrial({directory,operationId,fixture=false,wireFixture=false,wireFixtureScenario='complete',settings,goal='Create a checklist from these three requirements: bring water; confirm the address; leave ten minutes early.',acceptance=['Each supplied requirement appears exactly once; nothing is invented.']}){
 if(!['complete','incomplete-review','tool-call-builder'].includes(wireFixtureScenario)||!wireFixture&&wireFixtureScenario!=='complete')throw Error('WIRE_FIXTURE_SCENARIO_REQUIRED');
 if(wireFixture&&!fixture)throw Error('WIRE_FIXTURE_SCOPE_REQUIRED');
 if(!/^[A-Za-z0-9_-]{1,112}$/.test(operationId??''))throw Error('OPERATION_ID_REQUIRED');
 if(!fixture&&(!process.env.ALPHA_SMOKE_API_KEY||process.env.ALPHA_TEAM_TRIAL_ALLOW_LIVE!=='1'||process.env.ALPHA_TEAM_TRIAL_COST_AUTHORIZATION!=='uncapped'))throw Error('TRIAL_SECURE_CREDENTIAL_AND_AUTHORIZATION_REQUIRED');
 if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('TLS_VERIFICATION_REQUIRED');
 directory=resolve(directory);await mkdir(directory,{recursive:true,mode:0o700});
 const setupDirectory=join(directory,operationId+'-config');
 // A fresh setup directory is required. Existing operations are never silently restarted.
 const setup=await configureLuna(setupDirectory,settings);
 const config={...setup.config,executionPurpose:'single-model-team-trial'};
 config.models[0].id='luna-trial';config.bindings={};
 await writeFile(setup.configPath,JSON.stringify(config)+'\n',{mode:0o600});
 const overlay=JSON.parse(await readFile(setup.overlayPath,'utf8'));
 overlay.find(x=>x.id==='agent-default-model').config={provider:'alpha-trial-controller',model:'controller'};
 const runs=join(directory,'runs'),reportPath=join(directory,operationId+'-report.json');
 overlay.find(x=>x.insert).insert[0].config.stateDirectory=runs;
 overlay.push({insert:[{id:'alpha-team-trial-driver',name:join(root,'alpha/team-trial-plugin.mjs'),config:{modelConfigPath:setup.configPath,stateDirectory:runs,reportPath,operationId,fixture,wireFixture,goal,acceptance}}]});
 if(fixture&&!wireFixture)overlay.splice(overlay.findIndex(x=>x.id==='llm-pi-ai'),1);
 await writeFile(setup.overlayPath,JSON.stringify(overlay)+'\n',{mode:0o600});
 const isolatedCwd=join(setupDirectory,'workspace');await mkdir(isolatedCwd,{mode:0o700});
 const env={...process.env,DSH_HOME:join(setupDirectory,'home'),DSH_AGENTS_HOME:join(setupDirectory,'agents'),DSH_TELEMETRY_DISABLED:'1',DSH_TOOLS_MODE:'native',TSX_TSCONFIG_PATH:join(root,'tsconfig.json')};
 for(const key of Object.keys(env))if(/KEY|PASSWORD|SECRET|TOKEN/i.test(key)&&(fixture||key!=='ALPHA_SMOKE_API_KEY'))delete env[key];
 const args=[];
 if(!fixture||wireFixture){
  const guardPath=join(setupDirectory,'guard.json');
  await writeFile(guardPath,JSON.stringify({settings,wireFixture,wireFixtureScenario,reportPath:join(directory,operationId+'-usage.json')})+'\n',{mode:0o600});
  env.ALPHA_TEAM_TRIAL_GUARD_CONFIG=guardPath;
  if(wireFixture){env.ALPHA_SMOKE_API_KEY='alpha-synthetic-wire-fixture-only';env.ALPHA_TEAM_TRIAL_ALLOW_LIVE='1';env.ALPHA_TEAM_TRIAL_COST_AUTHORIZATION='uncapped';args.push('--import',join(root,'alpha/tests/team-trial-wire-fixture.mjs'));}
  args.push('--import',join(root,'alpha/team-trial-guard.mjs'));
 }
 args.push('--import',import.meta.resolve('tsx/esm'),join(root,'apps/cli/src/bin.ts'),'--profile','headless','--patch',setup.overlayPath,'Run the explicitly configured Alpha team trial once.');
 const child=spawn(process.execPath,args,{cwd:isolatedCwd,env,detached:true,stdio:['ignore','pipe','pipe']});
 let bytes=0,fixtureLog="";
 const stop=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{/* already exited */}};
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{bytes+=chunk.length;if(fixture)fixtureLog=(fixtureLog+chunk.toString()).slice(-20000);if(bytes>4*1024*1024)stop();});
 const timeout=setTimeout(stop,600000);
 const processResult=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}));}).finally(()=>clearTimeout(timeout));
 let report;try{report=JSON.parse(await readFile(reportPath,'utf8'));}catch{report={status:'blocked',code:'TRIAL_PROCESS_FAILED'};}
 if(fixture&&report.status==='blocked')await writeFile(join(directory,'fixture-diagnostics.log'),fixtureLog,{mode:0o600});
 let usage;
 if(!fixture||wireFixture){try{usage=JSON.parse(await readFile(join(directory,operationId+'-usage.json'),'utf8'));}catch{/* abrupt exit leaves usage unknown */}}
 return {...report,process:processResult,paidModelCalls:fixture?0:usage?.inferenceRequests??null,...(usage?{usage}:{}),rawLogsPersisted:fixture&&report.status==='blocked',reportPath};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const [directory,operationId]=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
  if(!directory)throw Error('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
  const settings=JSON.parse(await readFile(new URL('luna.gateway.json',import.meta.url),'utf8'));
  const report=await runTeamTrial({directory,operationId,fixture:process.argv.includes('--fixture')||process.argv.includes('--wire-fixture'),wireFixture:process.argv.includes('--wire-fixture'),settings});
  console.log(JSON.stringify(report,null,2));process.exitCode=['fixture_complete','same_model_trial_reviewed'].includes(report.status)&&report.process.code===0?0:2;
 }catch(error){console.error(JSON.stringify({status:'blocked',code:/^[A-Z_]+$/.test(error.message)?error.message:'TRIAL_SETUP_FAILED',paidModelCalls:0}));process.exitCode=2;}
}
