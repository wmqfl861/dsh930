/** Journaled paired research. This host program schedules; it is not an eighth lead model. */
import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { AlphaError, requireThat, copy, digest, preflight, validateBrief, validateOutput, validateCandidate, rolePrompt, validateRuntimeTeam } from './core.mjs';
import { OFFLINE_MODE, offlineManifest } from './offline.mjs';

/** Private local run directory. A concurrent or stale writer fails closed, never silently replays. */
export class RunStore {
  constructor(directory) { this.directory = resolve(directory); this.chain = Promise.resolve(); }
  async create(state) {
    requireThat(/^[0-9a-f-]{36}$/.test(state.id), 'STATE_ID', 'Run identity must be host-generated');
    await mkdir(this.directory, {recursive:true,mode:0o700});
    requireThat(!(await lstat(this.directory)).isSymbolicLink(), 'STATE_SYMLINK', 'State directory cannot be a symlink');
    this.file = join(this.directory, state.id + '.json');
    this.lock = await open(this.file + '.lock', 'wx', 0o600);
    try {
      const original = await open(this.file, 'wx', 0o600);
      await original.close();
      await this.save(state);
    } catch(error) {
      await this.lock.close(); await unlink(this.file+'.lock'); this.lock=undefined; throw error;
    }
  }
  save(state) {
    const text = JSON.stringify(copy(state),null,2) + '\n';
    const next = this.chain.then(async () => {
      const tmp = this.file + '.' + randomUUID() + '.tmp';
      const handle = await open(tmp,'wx',0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      await rename(tmp,this.file);
    });
    this.chain = next; return next;
  }
  async close() {
    try { await this.chain; } finally {
      if (this.lock) { await this.lock.close(); await unlink(this.file + '.lock'); this.lock = undefined; }
    }
  }
}

/** Each run captures immutable team, skill, model, brief and policy versions. */
export class AlphaRunner {
  constructor({team,skills,revision,config,executor,store,executionScope='team',invocation}) {
    requireThat(['team','research-pair','generated-team'].includes(executionScope),'EXECUTION_SCOPE','Unknown Alpha execution scope');
    this.team=copy(team); this.skills=copy(skills); this.revision=revision; this.config=copy(config);
    this.executor=executor; this.store=store; this.busy=false; this.manifestTeam=copy(team);
    this.executionScope=executionScope;
    this.invocation=invocation===undefined?undefined:copy(invocation);
    if (executionScope === 'generated-team') {
      validateRuntimeTeam(this.team);
      requireThat(['team-building','single-model-team-trial'].includes(this.config.executionPurpose ?? 'team-building'),'GENERATED_REVIEW','Generated teams require independent-model review or an explicit same-model trial');
    }
    if (executionScope === 'research-pair') {
      const research=this.team.roles.find(role=>role.id==='research');
      requireThat(research,'RESEARCH_ROLE','Research scope requires the research pair');
      this.team.roles=[{...research,dependsOn:[]}];
      this.team.logicalActors=2;
    }
    if (['single-model-smoke','single-model-research','single-model-team-trial'].includes(this.config.executionPurpose)) {
      this.team.limits.maxConcurrentPairs = 1;
      this.team.limits.maxDelegations = Math.min(this.team.limits.maxDelegations, this.config.executionPurpose==='single-model-smoke'?21:3);
      this.team.limits.maxRepairRounds = 0;
    }
  }
  async run(brief, signal) {
    requireThat(!this.busy,'RUN_BUSY','One runner instance owns one run at a time');
    validateBrief(brief);
    requireThat(this.config.executionPurpose!=='single-model-research'||this.executionScope==='research-pair','RESEARCH_SCOPE_REQUIRED','Single-model research is limited to the research pair');
    const p=preflight(this.team,this.config);
    requireThat(p.ready,'PREFLIGHT',p.issues.join(', '));
    requireThat(['fixture','dsh'].includes(this.executor.mode),'EXECUTOR','Explicit executor evidence mode required');
    if(this.executor.offline===true) requireThat(this.executor.offlineMode===OFFLINE_MODE,'OFFLINE_EXECUTOR','Offline injection must use the registered fixture bridge');
    this.busy=true;
    const ctl=new AbortController();
    const runSignal=signal ? AbortSignal.any([signal,ctl.signal]) : ctl.signal;
    this.state={schemaVersion:1,id:randomUUID(),mode:this.executor.mode,status:'preflight',executionPurpose:p.executionPurpose,independentReviewConfigured:p.independentReviewConfigured,qualityAcceptanceGranted:false,brief:copy(brief),briefHash:digest(brief),teamRevision:this.revision,configHash:digest(this.config),delegationsReserved:0,events:[],pairs:{},createdAt:new Date().toISOString()};
    if(this.invocation!==undefined)this.state.invocation=copy(this.invocation);
    if(this.executor.offline===true) this.state.offlineManifest=offlineManifest({team:this.manifestTeam,revision:this.revision,config:this.config});
    if(this.executionScope!=='team')this.state.executionScope=this.executionScope;
    if(this.executionScope==='generated-team') {this.state.team=copy(this.team);this.state.blueprintHash=this.team.blueprintHash;}
    let created=false;
    try {
      runSignal.throwIfAborted();
      await this.executor.preflight?.(this.team,this.config,runSignal);
      await this.store.create(this.state); created=true;
      await this.record('run-start',{logicalActors:this.team.roles.length*2,...(this.executionScope==='research-pair'?{executionScope:this.executionScope}:{})}); this.state.status='running';
      const pending=new Set(this.team.roles.map(r=>r.id));
      while(pending.size) {
        runSignal.throwIfAborted();
        const ready=this.team.roles.filter(r=>pending.has(r.id)&&r.dependsOn.every(d=>this.state.pairs[d]?.status==='reviewed')).slice(0,this.team.limits.maxConcurrentPairs);
        requireThat(ready.length>0,'DEPENDENCIES_BLOCKED','No runnable phase; an upstream pair is not reviewed');
        const settled=await Promise.allSettled(ready.map(role=>this.pair(role,runSignal).catch(error=>{ctl.abort(error);throw error;})));
        const failed=settled.find(r=>r.status==='rejected'); if(failed) throw failed.reason;
        for(const role of ready) pending.delete(role.id);
      }
      if(this.executionScope==='generated-team') {
        runSignal.throwIfAborted();
        this.state.status=this.executor.mode==='fixture'?'fixture_complete':'awaiting_human_acceptance';
        this.state.outputs=Object.fromEntries(this.team.roles.map(role=>[role.task.id,copy(this.state.pairs[role.id].draft.artifact)]));
        await this.record('run-end',{status:this.state.status});
        return copy(this.state);
      }
      if(this.executionScope==='research-pair') {
        this.state.status=this.executor.mode==='fixture'?'fixture_complete':'research_reviewed';
        await this.record('run-end',{status:this.state.status});
        return copy(this.state);
      }
      const candidate=this.state.pairs.integrator.draft.artifact;
      validateCandidate(candidate);
      const modelRefs=new Set(this.config.models.map(m=>m.id));
      requireThat(candidate.members.every(m=>modelRefs.has(m.modelRef)), 'CANDIDATE_MODEL', 'Candidate references an unconfigured model');
      requireThat(candidate.gaps.length===0,'CANDIDATE_GAPS','Integration still has unresolved capability gaps');
      requireThat(this.state.pairs.evaluator.draft.artifact?.acceptedCandidateHash === digest(candidate),'ACCEPTANCE_SUBJECT','Evaluator did not examine the exact integrated team version');
      this.state.candidateHash=digest(candidate);
      this.state.status=this.executor.mode==='fixture'?'fixture_complete':this.config.executionPurpose==='single-model-smoke'?'smoke_complete':'awaiting_human_acceptance';
      await this.record('run-end',{status:this.state.status});
      return copy(this.state);
    } catch(error) {
      this.state.status=signal?.aborted?'cancelled':'blocked';
      this.state.error={code:error.code??'RUN_ERROR',message:'Run stopped; inspect phase records and host diagnostics. No acceptance granted.'};
      if(created) await this.record('run-blocked',this.state.error);
      throw error;
    } finally {
      ctl.abort();
      try { if(created) await this.store.close(); } finally { this.busy=false; }
    }
  }
  reserve(count) {
    requireThat(this.state.delegationsReserved+count<=this.team.limits.maxDelegations,'DELEGATION_BUDGET','No budget for the complete main/shadow batch');
    this.state.delegationsReserved+=count;
  }
  async record(type,data) {
    this.state.events.push({seq:this.state.events.length,type,at:new Date().toISOString(),...copy(data)});
    await this.store.save(this.state);
  }
  async invoke(role,phase,input,signal) {
    signal.throwIfAborted();
    const side=['prepare','review'].includes(phase)?'shadow':'primary';
    const modelRef=this.config.bindings[role.id][side];
    const model=this.config.models.find(m=>m.id===modelRef);
    const actor=role[side];
    await this.record('actor-start',{role:role.id,actor,phase,modelRef,inputHash:digest(input)});
    const result=await this.executor.execute({actor,role:copy(role),phase,model:copy(model),input:copy(input),persona:rolePrompt(this.team,this.skills,role,phase),signal});
    signal.throwIfAborted();
    const value=validateOutput(phase,result,input.subjectHash,this.team.limits.maxResultBytes);
    await this.record('actor-end',{role:role.id,actor,phase,outputHash:digest(value)});
    return value;
  }
  async pair(role,signal) {
    this.reserve(3);
    const ctl=new AbortController();
    const scoped=AbortSignal.any([signal,ctl.signal,AbortSignal.timeout(this.team.limits.pairTimeoutMs)]);
    const upstream=Object.fromEntries(role.dependsOn.map(id=>[this.executionScope==='generated-team'?this.team.roles.find(r=>r.id===id).task.id:id,copy(this.state.pairs[id].draft)]));
    const input={brief:copy(this.state.brief),briefHash:this.state.briefHash,upstream};
    if(this.executionScope==='team'&&role.id==='evaluator') input.candidateHash=digest(upstream.integrator.artifact);
    input.allowedModelRefs=this.config.models.map(m=>m.id);
    input.availableSkills=Object.keys(this.skills);
    if(role.task) {input.step=copy(role.task);input.member=copy(role.member);}
    if (this.config.executionPurpose === 'single-model-team-trial') input.testScope='Same-model team trial: fresh contexts, not heterogeneous-model review or quality acceptance. No automatic retries or media generation.';
    if (this.config.executionPurpose === 'single-model-smoke') input.testScope='Single-model connectivity smoke only, not independent review or quality acceptance. Preserve evidence checks and real blockers.';
    if (this.config.executionPurpose === 'single-model-research') input.testScope='Real single-model exploratory research and design. Main and shadow use fresh contexts but the same model: not independent-model review or quality acceptance. Preserve real source receipts and blockers.';
    this.state.pairs[role.id]={status:'researching',main:role.primary,shadow:role.shadow};
    await this.record('pair-start',{role:role.id});
    const run=(phase)=>this.invoke(role,phase,input,scoped).catch(error=>{ctl.abort(error);throw error;});
    // No draft dependency: shadow is queued first and starts beside the primary.
    const tasks=[run('prepare'),run('draft')];
    const settled=await Promise.allSettled(tasks);
    const failed=settled.find(r=>r.status==='rejected'); if(failed) throw failed.reason;
    const prep=settled[0].value; let draft=settled[1].value;
    let review;
    for(let round=0;round<=this.team.limits.maxRepairRounds;round++) {
      if(round>0) {
        this.reserve(2);
        draft=await this.invoke(role,'revise',{...input,previous:draft,findings:review.findings},scoped);
      }
      const subjectHash=digest(draft);
      review=await this.invoke(role,'review',{...input,preparation:prep,draft,subjectHash},scoped);
      this.state.pairs[role.id]={status:review.verdict==='pass'?'reviewed':'needs_revision',main:role.primary,shadow:role.shadow,prep,draft,review,subjectHash,round};
      await this.record('pair-reviewed',{role:role.id,verdict:review.verdict,subjectHash,round});
      if(review.verdict==='pass') return;
      if(review.verdict==='blocked') break;
    }
    throw new AlphaError('REVIEW_NOT_PASSED',`${role.id} requires further work; iteration limit is not acceptance`);
  }
}

/** Read only a user-selected run file; this function performs no resume or model calls. */
export async function readRun(file) { return JSON.parse(await readFile(file,'utf8')); }
