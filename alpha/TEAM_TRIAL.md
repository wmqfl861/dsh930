# Same-model native team trial

This opt-in diagnostic generates a small specialist blueprint from a supplied requirement, then executes it through the existing generated-team runtime. The default `team-building` purpose still requires different underlying models. Host-owned `executionPurpose: "single-model-team-trial"` requires `acknowledgeNoIndependentReview: true`, exactly one configured route, and generated-team scope. A candidate cannot select the execution purpose or grant its own acknowledgement.

The native headless driver starts four fresh sessions: blueprint generation, shadow preparation, primary output, and hash-bound review. The blueprint is limited to one member, one step, and no tools. Every generated invocation uses a stable operation ID, reserved before the builder runs. No retries, media generation, installation, publishing, or automatic quality acceptance are included. A repeated launcher operation fails before dispatch; durable incomplete or failed operations are never silently rerun. The same operation must not be restarted under a new ID to evade this restriction.

## Zero-cost check

Use the repository's supported Node environment and installed dependencies:

```sh
node --test alpha/tests/team-trial.test.mjs
node alpha/team-trial.mjs /absolute/private/new-trial fixture-001 --fixture
```

The fixture uses the same native CLI, controller, child sessions, tool dispatch, generated-team compiler, runtime and review binding as the live path, with a deterministic model adapter. It does not verify the remote wire or model quality and never reads a key file or sends a model request. The report is `fixture_complete`, `paidModelCalls: 0`, `independentReviewConfigured: false`, and `qualityAcceptanceGranted: false`.

## Actual-provider wire fixture

`node alpha/team-trial.mjs /absolute/private/new-wire-trial wire-001 --wire-fixture` keeps the actual `llm-pi-ai` provider adapter, serialization and SSE parsing. A preloaded synthetic transport replaces fetch before the live guard is installed, retains no network fallback, and uses only a synthetic fixture credential. The unchanged guard checks all four actual adapter-emitted requests; responses and token usage are synthetic. This verifies local request compatibility and native orchestration, not the remote gateway, credentials or model quality. The report includes `wireFixture: true`, `paidModelCalls: 0`, `usage.synthetic: true`, `usage.inferenceRequests: 0` and `usage.fixtureRequests: 4`. The tests also cover incomplete review responses retaining usage and a forbidden builder tool call failing without another transport request. Both fixture modes use fresh isolated working directories and DSH homes to avoid loading repository or user environment files.

## User-initiated live trial

The existing `luna.gateway.json` selects the HTTPS Responses relay, `gpt-6-luna`, and reasoning `max`; the launcher does not substitute a model or endpoint. Settings are references, never credentials. The user must securely provide the existing key as `ALPHA_SMOKE_API_KEY` in the launching process, without putting it in chat, Git, config JSON, or command-line arguments. Merely possessing a key does not authorize a call.

After that secure credential step, the user can explicitly authorize this bounded trial in their own terminal:

```sh
ALPHA_TEAM_TRIAL_ALLOW_LIVE=1 ALPHA_TEAM_TRIAL_COST_AUTHORIZATION=uncapped \
  node alpha/team-trial.mjs /absolute/private/new-live-trial approved-trial-001
```

`uncapped` acknowledges that this trial has no monetary cap. It does not change the existing smoke or research budget policies. A live-only request guard allows at most four text-only inference requests to the configured exact Responses URL, with at most 4096 output tokens each, no provider retries and no redirects. Unexpected tools, endpoints and additional requests fail closed. Actual returned usage is recorded in the operation's usage report; absent gateway pricing remains `monetaryCostUsd: null`, never a fabricated price or zero-cost claim. The process has a ten-minute deadline; individual wire calls have a three-minute timeout. These bounds are not a provider-side spending guarantee.

A successful live report is `same_model_trial_reviewed`, with four distinct child IDs, generated blueprint and reviewed output. This is same-model fresh-context review, not heterogeneous-model review, production approval, or human quality acceptance. The live path is unverified until an authorized credential-bearing run succeeds. Raw live profile logs are not copied to the trial report; the private DSH session store still contains prompts and outputs. Fixture failures may retain fixture-only diagnostics.
