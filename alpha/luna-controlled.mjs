/** One explicit live run: at most 3 direct + 2 native requests under one reservation budget. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {configureLuna,probeLuna} from './luna-smoke.mjs';
import {liveBudgetFromEnv} from './luna-budget.mjs';
const folder=resolve(process.argv[2]??'.artifacts/luna-controlled');
await mkdir(dirname(folder),{recursive:true,mode:0o700});
try { await mkdir(folder,{mode:0o700}); }
catch(error) {
  console.error(JSON.stringify({status:'blocked',reason:error.code==='EEXIST'?'OUTPUT_DIRECTORY_EXISTS':'OUTPUT_DIRECTORY_UNAVAILABLE',inferenceRequests:0}));
  process.exit(2);
}
const report={schemaVersion:1,status:'not_started',maxInferenceRequests:5,inferenceRequests:0,successfulInferenceRequests:0,
  teamRun:false,qualityAcceptanceGranted:false,prior404Cause:'unproven; previous response body/content-type were not recorded'};
try {
  const settings=JSON.parse(await readFile(new URL('luna.gateway.json',import.meta.url),'utf8'));
  const setup=await configureLuna(join(folder,'private'),settings);report.configuration='passed';report.logicalActors=setup.logicalActors;
  const budget=liveBudgetFromEnv(process.env,5);
  report.credentialAvailable=Boolean(process.env.ALPHA_SMOKE_API_KEY);
  if(!report.credentialAvailable){report.status='credential_required';}
  else if(!budget.ready){report.status='budget_required';report.reason=budget.reason;}
  else {
    report.direct=await probeLuna(settings,process.env.ALPHA_SMOKE_API_KEY,budget.options);
    report.inferenceRequests=report.direct.inferenceRequests;report.successfulInferenceRequests=report.direct.successfulInferenceRequests;
    report.directBudget=budget.report();
    if(report.direct.status!=='model_probe_passed')report.status='direct_probe_blocked';
    else {
      const b=budget.report(); const remaining=b.maxUsd-b.reservedUsd;
      if(remaining<=0){report.status='budget_exhausted';}
      else {
        const {nativeLunaProbe}=await import('./luna-native-smoke.mjs');
        report.native=await nativeLunaProbe(settings,{outputDirectory:folder,budgetConfig:{maxUsd:remaining,
          inputRate:b.inputUsdPerMillion,outputRate:b.outputUsdPerMillion}});
        if(report.native.inferenceRequests===null){report.inferenceRequests=null;report.status='native_usage_unknown';}
        else {report.inferenceRequests+=report.native.inferenceRequests;report.successfulInferenceRequests+=report.native.successfulInferenceRequests??0;
          report.status=report.native.verified&&report.native.process.code===0?'bounded_smoke_passed':'native_probe_blocked';}
      }
    }
  }
  report.budget=budget.report();
}catch(error){report.status='blocked';report.reason=/^[A-Z_]+$/.test(error.message)?error.message:'CONTROLLED_TEST_ERROR';}
await writeFile(join(folder,'controlled-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='bounded_smoke_passed'?0:2;
