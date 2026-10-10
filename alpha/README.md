# DSH Alpha Team 0.1.0

English | [中文](README.zh.md)

Alpha is a team that researches, assembles, tests, and delivers other Agent teams, not a video company. Seven primary/shadow pairs make fourteen logical roles. The lead owns requirements and scheduling; the integrator remains independent; shadows research independently from the start. The host runner is a program, not a fifteenth team role.

## Deliverables and status

This directory provides an executable orchestration core, a native DSH subagent adapter, a loadable local Cordis plugin, seven role pairs, ten pinned Skills, and deterministic tests. It is neither a collection of prompts nor fourteen persistent instances signed into model services. The default is `liveEnabled=false`; calls are rejected when the model pool is unbound. No quality or cost comparison of real commercial models is provided.

The native adapter uses `ctx.subagents.start('spawn', ...)`, explicitly passing provider/model/maxTokens/persona/toolFilter and rejecting forks that inherit the parent conversation. Each primary/shadow pair must bind different canonicalModelId values; identical provider/model routes are rejected even when labels differ. canonicalModelId is administrator-verified configuration and does not guarantee that a third-party gateway never substitutes a route implicitly.

## Roles

| Primary | Shadow | Responsibility limits |
| --- | --- | --- |
| lead: communication, requirements, and scheduling | lead-shadow | Does not replace the integrator |
| research: domain research | research-shadow | Primary sources, counterevidence, and recency |
| architect: team and workflow design | architect-shadow | Minimal teams, handoffs, failures, and recovery requirements |
| model-lab: model experiments | model-lab-shadow | Comparable trials rather than brand rankings |
| skill-lab: Skill and tool engineering | skill-lab-shadow | Reuse, development, and isolated testing requirements |
| integrator: result integration | integrator-shadow | Consistent versions, transparent gaps, no self-scheduling |
| evaluator: independent acceptance | evaluator-shadow | Actual artifacts and tests, not only authors' reports |

Fourteen roles do not require fourteen different models; one model may serve several roles. Ten Skills live in `.dsh/skills/alpha-*/SKILL.md`: seven specialist methods and three shared methods for evidence research, parallel review, and capability development. All were written for this project; no online candidate Skill is presented as an installed or verified third-party capability.

## Keyless checks

Run from the repository root with Node 24:

```sh
node alpha/cli.mjs inspect
node --test alpha/tests/*.test.mjs
node alpha/cli.mjs fixture /tmp/alpha-fixture-runs
node alpha/cli.mjs preflight
```

With empty configuration, the last command is expected to return exit code 2 and UNBOUND_PAIR; do not change that rejection into success. `fixture` runs all seven pairs and 21 deterministic delegations, excluding revisions. Its result is always `fixture_complete`, not real research. With repository dependencies and build outputs installed, `node alpha/tests/native-smoke.mjs` also exercises the real DSH CLI, tool dispatch, subagent lifecycle, and model overrides. Responses and page fetches remain fixtures, with zero paid model calls.

## Connect to real DSH

1. Configure an available model provider and search/full-text fetch backends in DSH itself; this chat's GitHub, search, and image tools do not automatically become DSH tools.
2. Copy `models.example.json` outside the repository and fill in route references and seven pair bindings according to `BINDING_GUIDE.zh.md`. Give secrets only to DSH credential management, never this file.
3. An administrator enables `liveEnabled` only after the provider usage budget is explicit.
4. Generate an overlay portable to local paths and launch through a supported DSH profile:

```sh
node alpha/cli.mjs overlay /tmp/dsh-alpha.overlay.yml
export DSH_ALPHA_CONFIG=/absolute/private/alpha-models.json
export DSH_ALPHA_STATE_DIR=/absolute/private/alpha-runs
pnpm dsh --profile headless --patch /tmp/dsh-alpha.overlay.yml "先运行 alpha_preflight；只有配置完整后，按我的目标调用 alpha_build_team"
```

Web mode accepts the same overlay through `pnpm dsh web --patch /tmp/dsh-alpha.overlay.yml`. Web UI buttons and a team dashboard are not additions in this version. Tools include `alpha_preflight`, `alpha_build_team`, `alpha_research_pair`, and `alpha_execute_team`; merely loading the plugin triggers no model calls. Tools currently execute in the foreground. Cancelling a call cancels child runs and waits for cleanup; this is not a persistent background service.

## Program-enforced rules

Each pair reserves resources for its complete batch, queues shadow preliminary research before the primary task, and then starts the primary task concurrently. Formal review waits for both; preliminary shadow input contains no primary draft. Formal review carries the preliminary research record and primary draft hash. A revision produces a new hash, making the previous review unusable. Dependent stages accept only reviewed upstream versions. Revision limits, timeouts, child-run failures, stale reviews, and unresolved risks cannot pass automatically.

The initial primary drafts and shadow preliminary research for research, model experiments, and Skill engineering must cite sources fetched by that child through native `web_fetch` during the current call. DSH `tools/result` events capture execution records matched to the actual child identity; another child's fetches and author-forged `_host` fields do not count. This requirement proves a fetch occurred, not that the page is accurate or complete or that research was deep. Depth and professional quality still require shadow review, business evaluation, and human calibration. Upstream may return non-2xx pages as body text, so their content still needs review. Fetch counts are not quality scores.

The host persists all results. By default, children receive only read-only web tools, with no read/write/bash, installation, publication, or recursive delegation tools. Source editing and sandbox experiments require qualified controlled tools before they can be added; prompts cannot bypass this restriction. Requirements, model configuration, and Skill contents are copied and hash-pinned at startup. Results go to a private directory; exclusive locking and atomic replacement prevent silent overwrites.

## Limitations that must remain explicit

- This is the first Alpha team-building and research orchestrator, not a complete production platform. Administrators currently supply model bindings. model-lab may recommend target-team models and new configuration but cannot change core primary/shadow bindings within a run.
- Shadow preliminary research and review are two fresh child runs of one logical role; the latter explicitly receives verified material. Persistent sessions are not promised. Immediate major-risk reporting, live requirement-change broadcasts, global DAG recovery, and background execution remain unimplemented.
- Snapshots and event records support diagnosis; failures do not automatically replay external operations. An operator must confirm the original process has stopped before handling a leftover lock. This version claims neither exactly-once execution nor automatic recovery.
- `maxDelegations` limits subagent delegation count; `maxTokens` configures native requests. Neither is a hard dollar or total-token cap. Providers or controlled gateways must enforce actual spending limits. Paid calls are disabled by default.
- Engineering roles have no arbitrary code execution or automatic installation tools. Generated teams can explicitly run read-only tasks through `alpha_execute_team`, but no business-code trial runner starts automatically. Teams may submit prototypes and experiment plans; unexecuted work must remain not_executed with the corresponding gap. JSON workflow validation is not business end-to-end acceptance.
- Regardless of shadow evaluations, a complete run reaches at most `awaiting_human_acceptance`. There is no automatic publication, deployment, or overwrite of main. Professional quality, aesthetics, real-model costs, and comparative performance against the pi route have not been established.

## Comparison with the pi route

Use identical briefs, available resources, acceptance requirements, and budgets, plus a separate comparison at similar total cost. Compare generated teams' task success, evidence accuracy, shadow false alarms or regressions, human rework, and costs. `evals/tasks.json` contains public development cases, not a confidential test set. The user supplies independent cases for final blind evaluation; neither side modifies the other's workspace.

## Initial validation record

Under Node 24.21.0, all 67 automated tests passed with zero failures or skips. Independent MJS lint covered 12 source files with zero errors or warnings. Native DSH headless integration passed with seven role pairs and 21 child calls. Model and web backends were deterministic fixtures, so this is not real multi-model research or business acceptance. Empty-configuration preflight rejected calls as expected. See `reports/validation.json` for logs and scope.

For independent checks of added MJS files, use `node node_modules/oxlint/bin/oxlint -c alpha/oxlint.json --no-ignore alpha --threads 1`. Repository default lint ignores MJS; silence from the default command does not replace this check.

## Execute generated teams

`alpha_build_team` still uses seven role pairs to build teams; the generated team has no fixed role count. Serialize the selected artifact and pass it as `candidateJson` to `alpha_execute_team`, supplying a stable `operationId` of 1–128 letters, digits, underscores, or hyphens. Retries must reuse the original ID, never generate a new ID each time. Every member supplies configured `modelRef` and `shadowModelRef`, responsibilities, pinned skills, and read-only tools. The default team-building mode requires different models. Every step supplies owner, dependsOn, input, output, and check; currently, only `stop` is executable as onFailure. Unknown skills or models, missing dependencies, cycles, unresolved gaps, unused members, and budgets insufficient for all tasks are rejected before any child call.

Each step creates independent primary/shadow tasks; step count determines logicalActors for the run. Multiple steps sharing one member still use fresh child runs. Upstream work must pass hash-bound shadow review before downstream handoff. By default, primary and shadow use different administrator-configured models; single-model smoke/research configuration cannot execute generated teams. Budgets, timeouts, tool scope, and Skill contents come from the host; generated JSON cannot raise permissions or budgets. Generated roles configured with web_fetch must each obtain native fetch evidence for both primary drafts and shadow preliminary research, regardless of role names.

The explicit host configuration `executionPurpose=single-model-team-trial` with `acknowledgeNoIndependentReview=true` permits generated-team diagnostics with exactly one configured model route, one member, one step, and no tools. Primary, preliminary shadow research, and review still use fresh child contexts, but this is not independent-model review. Reports retain independentReviewConfigured=false and qualityAcceptanceGranted=false. This exception does not enable same-model core team building. See [the team-trial guide](TEAM_TRIAL.md) ([中文](TEAM_TRIAL.zh.md)) for the verified keyless path and live-call requirements.

Results include blueprintHash, every step's output, and complete logs, always retaining qualityAcceptanceGranted=false. Read-only structured artifacts reach at most awaiting_human_acceptance; fixtures report fixture_complete. Failure and cancellation wait for started tasks to clean up, with no automatic rerun, installation, file writing, or publication. Final cross-task business-quality evaluation, background recovery, and hard spending limits still require separate integration and validation.

Run offline regression checks with `node --test alpha/tests/generated-team.test.mjs alpha/tests/adapter.test.mjs`. Deterministic real-DSH-composition scenarios are included in `node alpha/tests/native-smoke.mjs`, which requires installed repository dependencies but makes no paid model calls. Offline success does not validate real-model quality or live configuration.

Invocation deduplication records share the private directory with run files. Before the first child call, the host exclusively reserves operationId and durably binds hashes of the blueprint, input, model configuration, execution mode, and version; POSIX also synchronizes the directory. A completed invocation with the same ID and content returns the same result and run ID without calling models again; changed content is rejected. Running, failed, cancelled, crashed, or corrupt records never rerun automatically. Only an operator who checks the previous attempt and deliberately supplies a new ID starts another attempt. Windows does not support this implementation's directory fsync, so power-loss durability differs from POSIX.

This deduplicates generated-team invocations; it does not guarantee exactly-once execution by external model services. A provider may execute a network request before the process exits; unknown local state is not treated as safe to retry. Failure to write completion also never automatically repeats execution. Clearing or replacing the entire state directory loses historical deduplication records and must not be used as a retry mechanism.
