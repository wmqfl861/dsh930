# Alpha offline bridge

`offline.mjs` adds a small, explicitly opted-in injected-handler adapter and a
stable roster manifest. It does not change the default seven-pair roster, the
normal DSH adapter, or the normal fixed state-directory behavior.

Use `createOfflineExecutor({ offline: true, handler })` (or the explicit
`allowOffline` / `offlineFixture` aliases) to cross this seam. Live/provider,
network, endpoint, credential, disabled, missing-handler, and malformed-output
options fail closed. `offlineManifest()` validates the fixed seven-role team or an explicitly marked generated-team DAG
and hashes only stable team, revision, and optional configuration data; it
contains no timestamp or generated run id.

This is an integration boundary, not a security sandbox. The wrapper itself
does not resolve providers, read credentials, create child agents, or perform
network I/O, but a caller-supplied handler can do arbitrary work. An offline
claim therefore requires inspecting the injected handler and its dependencies.
Cancellation is cooperative: the adapter checks the signal before and after
the handler settles, and does not pretend unfinished work has stopped. The
native DSH adapter continues to await child disposal when cancellation or
failure occurs.

Run `node --test alpha/tests/offline.test.mjs alpha/tests/adapter.test.mjs` for
the injected seam, stable manifest, fail-closed options, and DSH cleanup checks.

Generated packages run through `runGeneratedTeam()` in `generated-team.mjs`,
which resolves their model and locked-skill references before invoking the same
Alpha runner. The `alpha_execute_team` tool exposes this path through DSH. The
manifest records the variable runtime roster; its revision binds the selected
blueprint. Fixture completion remains test evidence, not quality acceptance.

Generated invocations require a stable caller `operationId`. Their durable
reservation binds the blueprint, inputs, route configuration, revision and
executor mode before dispatch. Matching completed invocations return their
original verified result; unfinished, failed, cancelled or uncertain records
reject automatic reruns. A deliberately new ID starts a new invocation.
This deduplicates invocation admission, not external provider effects. Keep
the state directory intact; changing it loses the deduplication history.
