#!/usr/bin/env node
/** Offline validation/fixture utility; live application launches belong to dsh profiles only. */
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { loadTeam,preflight,readJson } from './core.mjs';
import { AlphaRunner,RunStore,readRun } from './runner.mjs';

async function main(){
  const [command,arg]=process.argv.slice(2);
  const loaded=await loadTeam();
  if(command==='inspect'){
    console.log(JSON.stringify({team:loaded.team.id,version:loaded.team.version,logicalActors:14,skills:Object.keys(loaded.skills),revision:loaded.revision,roles:loaded.team.roles.map(r=>({primary:r.primary,shadow:r.shadow,dependsOn:r.dependsOn}))},null,2));return;
  }
  if(command==='preflight'){
    const config=await readJson(arg?resolve(arg):new URL('models.example.json',import.meta.url));
    const report=preflight(loaded.team,config);console.log(JSON.stringify(report,null,2));process.exitCode=report.ready?0:2;return;
  }
  if(command==='fixture'){
    const {fixtureConfig,fixtureExecutor}=await import('./fixtures.mjs');
    const store=new RunStore(arg?resolve(arg):join(tmpdir(),'dsh-alpha-fixtures'));
    const runner=new AlphaRunner({...loaded,config:fixtureConfig(loaded.team),executor:fixtureExecutor(),store});
    const result=await runner.run({goal:'TEST ONLY: construct a sample research team',acceptance:['fixture structural checks'],constraints:['No model/network calls']});
    console.log(JSON.stringify({status:result.status,mode:result.mode,logicalActors:14,pairs:Object.keys(result.pairs).length,delegations:result.delegationsReserved,file:store.file,warning:'Fixture execution is NOT real multi-model research or team-quality validation.'},null,2));return;
  }
  if(command==='status'&&arg){console.log(JSON.stringify(await readRun(resolve(arg)),null,2));return;}
  if(command==='overlay'&&arg){
    const plugin=fileURLToPath(new URL('dsh-plugin.mjs',import.meta.url));
    await writeFile(resolve(arg),`- insert:\n    - id: dsh-alpha-team\n      name: ${JSON.stringify(plugin)}\n      config:\n        modelConfigPath: !!js process.env.DSH_ALPHA_CONFIG\n        stateDirectory: !!js process.env.DSH_ALPHA_STATE_DIR\n`,{flag:'wx',mode:0o600});
    console.log('Overlay created; launch with pnpm dsh --profile headless --patch '+resolve(arg)+' "Use alpha_preflight first"');return;
  }
  throw new Error('Usage: node alpha/cli.mjs inspect | preflight [private-models.json] | fixture [output-dir] | status <run.json> | overlay <new-output.yml>');
}
main().catch(error=>{console.error(`${error.code??'ERROR'}: ${error.message}`);process.exitCode=1;});
