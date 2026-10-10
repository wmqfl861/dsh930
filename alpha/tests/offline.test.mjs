import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTeam, digest } from '../core.mjs';
import { createOfflineExecutor, offlineManifest, OFFLINE_MODE } from '../offline.mjs';

const loaded = await loadTeam();
const call = () => ({ signal: new AbortController().signal, role: { id: 'research' }, phase: 'draft' });

test('offline handler requires an explicit opt-in and injected function', () => {
  assert.throws(() => createOfflineExecutor({ handler: async () => ({}) }), { code: 'OFFLINE_OPT_IN' });
  assert.throws(() => createOfflineExecutor({ offline: true }), { code: 'OFFLINE_HANDLER' });
});

test('offline executor rejects live/provider/network/credential configuration', () => {
  for (const key of ['provider', 'network', 'fetch', 'transport', 'endpoint', 'url', 'apiKey', 'credentials', 'token', 'client']) {
    assert.throws(() => createOfflineExecutor({ offline: true, handler: async () => ({}), [key]: null }), { code: 'OFFLINE_LIVE_OPTION' }, key);
  }
  assert.throws(() => createOfflineExecutor({ offline: true, liveEnabled: true, handler: async () => ({}) }), { code: 'OFFLINE_LIVE_OPTION' });
  assert.throws(() => createOfflineExecutor({ offline: true, enabled: false, handler: async () => ({}) }), { code: 'OFFLINE_DISABLED' });
  assert.throws(() => createOfflineExecutor({ offline: true, handler: 'not a handler' }), { code: 'OFFLINE_HANDLER' });
});

test('offline handler returns detached deterministic JSON data', async () => {
  const source = { ok: true, nested: { value: 1 } };
  const executor = createOfflineExecutor({ offline: true, handler: async () => source });
  const first = await executor.execute(call());
  first.nested.value = 99;
  assert.equal(source.nested.value, 1);
  assert.equal(executor.mode, 'fixture');
  assert.equal(executor.offlineMode, OFFLINE_MODE);
});

test('offline handler abort is honored before and after injected work', async () => {
  const ctl = new AbortController();
  ctl.abort(new Error('stop before work'));
  let calls = 0;
  const executor = createOfflineExecutor({ offline: true, handler: async () => { calls++; return {}; } });
  await assert.rejects(executor.execute({ ...call(), signal: ctl.signal }), /stop before work/);
  assert.equal(calls, 0);

  const active = new AbortController();
  let entered, finish;
  const enteredHandler = new Promise(resolve => { entered = resolve; });
  const finishHandler = new Promise(resolve => { finish = resolve; });
  const pending = createOfflineExecutor({ offline: true, handler: async () => { entered(); await finishHandler; return {}; } });
  let settled = false;
  const running = pending.execute({ ...call(), signal: active.signal }).finally(() => { settled = true; });
  await enteredHandler;
  active.abort(new Error('stop after work'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'abort must not pretend injected work has settled');
  finish();
  await assert.rejects(running, /stop after work/);
  assert.equal(settled, true);
});

test('offline handler rejects malformed return values and does not swallow its error', async () => {
  for (const value of [null, [], new Date(), undefined]) {
    const executor = createOfflineExecutor({ offline: true, handler: async () => value });
    await assert.rejects(executor.execute(call()), { code: 'OFFLINE_OUTPUT' });
  }
  const failure = new Error('injected failure');
  const executor = createOfflineExecutor({ offline: true, handler: async () => { throw failure; } });
  await assert.rejects(executor.execute(call()), error => error === failure);
});

test('manifest digest is deterministic and binds fixed seven-role roster/config', () => {
  const a = offlineManifest({ team: loaded.team, revision: loaded.revision, config: { z: 1, a: 2 } });
  const b = offlineManifest({ team: loaded.team, revision: loaded.revision, config: { a: 2, z: 1 } });
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash, digest(Object.fromEntries(Object.entries(a).filter(([key]) => key !== 'hash'))));
  assert.equal(a.mode, OFFLINE_MODE);
  assert.equal(a.team.roles.length, 7);
  assert.equal(a.team.logicalActors, 14);
});

test('manifest changes when roster or immutable revision changes', () => {
  const base = offlineManifest({ team: loaded.team, revision: 'r1' });
  assert.notEqual(base.hash, offlineManifest({ team: loaded.team, revision: 'r2' }).hash);
  const changed = structuredClone(loaded.team);
  changed.roles[0].tools = ['web_search'];
  assert.notEqual(base.hash, offlineManifest({ team: changed, revision: 'r1' }).hash);
  assert.throws(() => offlineManifest({ team: { roles: [] } }), { code: 'TEAM' });
});
