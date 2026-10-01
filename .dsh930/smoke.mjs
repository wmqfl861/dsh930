/** Exercise the real Web profile, including its token-to-cookie login flow. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.match(process.versions.node, /^24\./, 'This development baseline requires Node 24');
const home = await mkdtemp(join(tmpdir(), 'dsh930-web-smoke-'));
const port = 3080;
const base = `http://127.0.0.1:${port}/`;
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--no-open', '--port', String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let spawnError;
let exited = false;
const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve(); }));
child.once('error', error => { spawnError = error; });
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', chunk => { output = (output + chunk).slice(-128 * 1024); });
}
const request = (url, options = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
try {
  let login;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnError) throw spawnError;
    if (exited) throw new Error('Web profile exited before becoming ready');
    const match = /http:\/\/127\.0\.0\.1:3080\/\?token=[A-Za-z0-9_-]+/.exec(output);
    if (match) { login = match[0]; break; }
    await delay(500);
  }
  assert.ok(login, 'Web profile must publish its authenticated local launch URL');
  const anonymous = await request(base);
  assert.equal(anonymous.status, 401, 'Anonymous index requests must remain unauthorized');
  await anonymous.arrayBuffer();
  const authorization = await request(login);
  assert.equal(authorization.status, 303, 'A valid launch token must redirect into cookie authentication');
  const cookies = authorization.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  assert.ok(cookies, 'Token exchange must set a browser cookie');
  const location = authorization.headers.get('location');
  assert.ok(location, 'Token exchange must return a redirect location');
  const destination = new URL(location, base);
  assert.equal(destination.origin, new URL(base).origin, 'Login must not redirect to another origin');
  assert.equal(destination.searchParams.has('token'), false, 'Login must remove the token from the destination');
  await authorization.arrayBuffer();
  const index = await request(destination, { headers: { cookie: cookies } });
  assert.equal(index.status, 200, 'Authenticated browsers must receive the built Web UI');
  assert.match(index.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(await index.text(), /<html[\s>]/i);
  console.log(JSON.stringify({ node: process.version, anonymousStatus: 401, tokenExchangeStatus: 303, authenticatedStatus: 200, authenticationEnforced: true, modelApiCalls: 0 }));
} catch (error) {
  // The launch token is deliberately excluded from diagnostics and CI artifacts.
  console.error(output.replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]'));
  throw error;
} finally {
  if (!exited) child.kill('SIGTERM');
  await Promise.race([closed, delay(5000)]);
  if (!exited) {
    child.kill('SIGKILL');
    await closed;
  }
  await rm(home, { recursive: true, force: true });
}
