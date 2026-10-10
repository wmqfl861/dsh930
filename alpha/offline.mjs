/**
 * Deterministic, in-process Alpha executor used by the offline validation
 * slice. This wrapper never discovers a provider, reads credentials, opens a
 * socket, or starts a child process. The injected handler is caller-owned and
 * can still perform arbitrary work; this is an explicit integration seam, not
 * a sandbox or proof that the handler is offline. Callers must opt in
 * explicitly with `offline: true` (aliases are accepted
 * for small host adapters which already use `allowOffline` or
 * `offlineFixture`).
 */
import { AlphaError, canonical, copy, digest, object, requireThat, validateTeam, validateRuntimeTeam } from './core.mjs';

export const OFFLINE_MODE = 'offline-fixture';

const forbiddenOptionKeys = new Set([
  'provider', 'network', 'fetch', 'transport', 'endpoint', 'url',
  'apiKey', 'credential', 'credentials', 'token', 'client',
]);

function explicitOptIn(options) {
  return options?.offline === true || options?.allowOffline === true || options?.offlineFixture === true;
}

function assertPlainRecord(value, code, message) {
  requireThat(object(value) && Object.getPrototypeOf(value) === Object.prototype, code, message);
}

/**
 * Build a stable manifest for an offline run.  The hash excludes timestamps,
 * run ids, handler identity and any other per-invocation value.
 */
export function offlineManifest({ team, revision = undefined, config = undefined } = {}) {
  assertPlainRecord(team, 'OFFLINE_MANIFEST', 'Offline manifest requires a team object');
  if (team.kind === 'generated-team') validateRuntimeTeam(team); else validateTeam(team);
  const roles = Array.isArray(team.roles) ? team.roles.map(role => ({
    id: role.id,
    primary: role.primary,
    shadow: role.shadow,
    dependsOn: [...(role.dependsOn ?? [])],
    tools: [...(role.tools ?? [])],
  })) : [];
  const body = {
    schemaVersion: 1,
    mode: OFFLINE_MODE,
    team: {
      id: team.id,
      version: team.version,
      schemaVersion: team.schemaVersion,
      logicalActors: team.logicalActors,
      roles,
      limits: copy(team.limits),
    },
    revision: revision ?? digest(team),
    ...(config === undefined ? {} : { configHash: digest(config) }),
  };
  // Keep undefined fields out of the serialized manifest so equivalent calls
  // have byte-for-byte identical output.
  const manifest = JSON.parse(canonical(body));
  return Object.freeze({ ...manifest, hash: digest(manifest) });
}

function validateHandlerOptions(options) {
  requireThat(explicitOptIn(options), 'OFFLINE_OPT_IN', 'Offline execution requires explicit injected-handler opt-in');
  requireThat(options.enabled !== false, 'OFFLINE_DISABLED', 'Offline execution was explicitly disabled');
  if (options.mode !== undefined) requireThat(options.mode === 'fixture', 'OFFLINE_LIVE_OPTION', 'Offline executor mode must be fixture');
  for (const key of Object.keys(options ?? {})) {
    requireThat(!forbiddenOptionKeys.has(key), 'OFFLINE_LIVE_OPTION', `Offline executor rejects live/network option: ${key}`);
  }
  requireThat(options.liveEnabled !== true, 'OFFLINE_LIVE_OPTION', 'Offline executor cannot be paired with live-enabled configuration');
  requireThat(typeof options.handler === 'function' || typeof options.execute === 'function', 'OFFLINE_HANDLER', 'Offline execution requires an injected handler');
}

/**
 * Create an executor suitable for AlphaRunner's fixture mode.  The handler is
 * the only execution seam and receives the same call object as fixtureExecutor
 * (including an AbortSignal).  Every result is copied and checked before it is
 * returned, preventing a handler from smuggling mutable state into a journal.
 */
export function createOfflineExecutor(input, maybeOptions = {}) {
  const options = typeof input === 'function' ? { ...maybeOptions, handler: input } : (input ?? {});
  validateHandlerOptions(options);
  const handler = options.handler ?? options.execute;
  const manifest = options.manifest === undefined
    ? (options.team === undefined ? undefined : offlineManifest({ team: options.team, revision: options.revision, config: options.config }))
    : copy(options.manifest);
  if (manifest !== undefined) assertPlainRecord(manifest, 'OFFLINE_MANIFEST', 'Offline manifest must be a plain object');
  return {
    mode: 'fixture',
    offline: true,
    offlineMode: OFFLINE_MODE,
    manifest,
    async execute(call) {
      requireThat(call && call.signal && typeof call.signal.throwIfAborted === 'function', 'OFFLINE_CALL', 'Offline call requires an AbortSignal');
      call.signal.throwIfAborted();
      const value = await handler(call);
      call.signal.throwIfAborted();
      assertPlainRecord(value, 'OFFLINE_OUTPUT', 'Offline handler must return a JSON object');
      try {
        return copy(value);
      } catch {
        throw new AlphaError('OFFLINE_OUTPUT', 'Offline handler returned a non-serializable object');
      }
    },
  };
}

// Name used by a few host integrations; keep it as a semantic alias rather
// than a second implementation so the safety checks cannot drift.
export const createOfflineInjectedExecutor = createOfflineExecutor;
