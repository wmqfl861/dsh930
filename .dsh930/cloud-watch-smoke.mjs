/** Verify source edit -> rebuilt bundle -> authenticated HTTP resource, then restore. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.match(process.versions.node, /^24\./);
const source = 'packages/client/ui-settings-general/src/client/index.ts';
const packageId = '@deepseek-ai/dsh-client-ui-settings-general';
const original = await readFile(source);
const marker = `DSH930_WATCH_${randomUUID().replaceAll('-', '')}`;
const home = await mkdtemp(join(tmpdir(), 'dsh930-watch-'));
const base = 'http://127.0.0.1:3080/';
let output = '', login, exited = false, spawnError;
const child = spawn('pnpm', ['run', 'dev:web', '--skip-build', '--no-open', '--port', '3080'], {
  env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  detached: true, stdio: ['ignore', 'pipe', 'pipe'],
});
const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve(); }));
child.once('error', error => { spawnError = error; });
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    output = (output + chunk).slice(-1024 * 1024);
    login ??= /http:\/\/127\.0\.0\.1:3080\/\?token=[A-Za-z0-9_-]+/.exec(output)?.[0];
  });
}
const request = (url, options = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
async function until(label, fn, seconds = 120) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (spawnError) throw spawnError;
    assert.ok(!exited, `Development server exited during ${label}`);
    const value = await fn();
    if (value) return value;
    await delay(500);
  }
  throw new Error(`Timed out: ${label}`);
}
function signalGroup(signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
try {
  await until('development startup', () => login && output.includes('dev-web: watching'));
  const anonymous = await request(base);
  assert.equal(anonymous.status, 401);
  await anonymous.arrayBuffer();
  const auth = await request(login);
  assert.equal(auth.status, 303);
  const cookie = auth.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  assert.ok(cookie);
  await auth.arrayBuffer();
  async function resource() {
    const index = await request(base, { headers: { cookie, 'cache-control': 'no-cache' } });
    assert.equal(index.status, 200);
    const html = await index.text();
    const match = /<script>globalThis\["__DSH_BOOT__"\]\s*=\s*([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, 'Authenticated HTML must include its boot graph');
    const entry = JSON.parse(match[1]).entries.find(row => row.id === packageId);
    assert.ok(entry, 'The edited package must be mounted');
    const response = await request(new URL(entry.url, base), { headers: { cookie } });
    if (response.status === 404) { await response.arrayBuffer(); return undefined; }
    assert.equal(response.status, 200);
    return { rev: entry.rev, body: await response.text() };
  }
  const before = await until('original resource', resource);
  assert.equal(before.body.includes(marker), false);
  await writeFile(source, Buffer.concat([original, Buffer.from(`\nconsole.info(${JSON.stringify(marker)});\n`)]));
  const edited = await until('source edit served through HTTP', async () => {
    const current = await resource();
    return current && current.rev !== before.rev && current.body.includes(marker) && current;
  });
  await writeFile(source, original);
  await until('source restoration served through HTTP', async () => {
    const current = await resource();
    return current && current.rev !== edited.rev && !current.body.includes(marker) && current;
  });
  assert.deepEqual(await readFile(source), original);
  console.log(JSON.stringify({ node: process.version, packageId, sourceEditRebuiltAndServed: true,
    sourceRestoredAndServed: true, authenticationEnforced: true,
    sourceSha256: createHash('sha256').update(original).digest('hex'), modelApiCalls: 0 }));
} catch (error) {
  console.error(output.replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]'));
  throw error;
} finally {
  await writeFile(source, original);
  signalGroup('SIGTERM');
  await Promise.race([closed, delay(15000)]);
  signalGroup('SIGKILL');
  if (!exited) await closed;
  await rm(home, { recursive: true, force: true });
}
