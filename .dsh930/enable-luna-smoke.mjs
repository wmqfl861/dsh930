/** Source-only migration from the verified Alpha v0.1. No credentials or endpoint requests. */
import {readFile,writeFile} from 'node:fs/promises';
async function patch(path,changes){let text=await readFile(path,'utf8');for(const [before,after]of changes){if(text.split(before).length!==2)throw Error('Unexpected source baseline: '+path);text=text.replace(before,after);}await writeFile(path,text);}
await patch('alpha/core.mjs',[
 ["const issues = [];", "const issues = [];\n  const executionPurpose = config.executionPurpose ?? 'team-building';\n  const smoke = executionPurpose === 'single-model-smoke';\n  if (!['team-building', 'single-model-smoke'].includes(executionPurpose)) issues.push('EXECUTION_PURPOSE_INVALID');\n  if (smoke && config.acknowledgeNoIndependentReview !== true) issues.push('SMOKE_ACK_REQUIRED');"],
 ["if (!config.liveEnabled)","if (config.liveEnabled !== true)"],
 ["  for (const role of team.roles) {\n    const b = config.bindings[role.id];", "  if (smoke && models.size !== 1) issues.push('SMOKE_SINGLE_ROUTE_REQUIRED');\n  for (const role of team.roles) {\n    const b = config.bindings[role.id];"],
 ["if (main.canonicalModelId === shadow.canonicalModelId || (main.model === shadow.model && main.provider === shadow.provider)) {", "if (!smoke && (main.canonicalModelId === shadow.canonicalModelId || (main.model === shadow.model && main.provider === shadow.provider))) {"],
 ["return { ready: issues.length === 0, issues };", "return { ready: issues.length === 0, issues, executionPurpose, independentReviewConfigured: !smoke, warnings: smoke ? ['SINGLE_MODEL_SMOKE_NOT_QUALITY_ACCEPTANCE'] : [] };"],
]);
await patch('alpha/runner.mjs',[
 ["this.executor=executor; this.store=store; this.busy=false;", "this.executor=executor; this.store=store; this.busy=false;\n    if (this.config.executionPurpose === 'single-model-smoke') {\n      this.team.limits.maxConcurrentPairs = 1;\n      this.team.limits.maxDelegations = Math.min(this.team.limits.maxDelegations, 21);\n      this.team.limits.maxRepairRounds = 0;\n    }"],
 ["mode:this.executor.mode,status:'preflight',brief:", "mode:this.executor.mode,status:'preflight',executionPurpose:p.executionPurpose,independentReviewConfigured:p.independentReviewConfigured,qualityAcceptanceGranted:false,brief:"],
 ["this.executor.mode==='fixture'?'fixture_complete':'awaiting_human_acceptance'", "this.executor.mode==='fixture'?'fixture_complete':this.config.executionPurpose==='single-model-smoke'?'smoke_complete':'awaiting_human_acceptance'"],
 ["input.allowedModelRefs=this.config.models.map(m=>m.id);", "input.allowedModelRefs=this.config.models.map(m=>m.id);\n    if (this.config.executionPurpose === 'single-model-smoke') input.testScope='Single-model connectivity smoke only, not independent review or quality acceptance. Preserve evidence checks and real blockers.';"],
]);
console.log('Applied explicit single-model smoke mode; normal team-building rules preserved.');
