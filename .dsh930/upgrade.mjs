/** Upgrade registry dependencies without discarding upstream patches or workspace links. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
if (!/^24\./.test(process.versions.node)) throw new Error('Node 24 is required');
const pnpmVersion = process.env.DSH930_PNPM_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(pnpmVersion ?? '')) throw new Error('A resolved stable pnpm version is required');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? 'pipe' : 'inherit',
    env: { ...process.env, PNPM_CONFIG_INCLUDE_WORKSPACE_ROOT: 'true' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${result.status}\n${result.stderr ?? ''}`);
  return (result.stdout ?? '').trim();
};
const pm = (args, capture = false) => run('pnpm', args, capture);
const config = key => {
  const value = pm(['config', 'get', key, '--json'], true);
  return !value || value === 'undefined' ? undefined : JSON.parse(value);
};
const nameOf = spec => {
  const match = /^(@[^/\s]+\/[^@\s]+|[^@\s]+)(?:@.*)?$/.exec(spec);
  if (!match) throw new Error(`Unsupported dependency selector: ${spec}`);
  return match[1];
};
const sections = ['dependencies', 'devDependencies', 'optionalDependencies'];
const local = /^(workspace|link|file|portal|patch):/;
mkdirSync('.dsh930', { recursive: true });
const originalRoot = json('package.json');
const manifest = structuredClone(originalRoot);
manifest.engines = { ...manifest.engines, node: '>=24.0.0 <25.0.0' };
manifest.packageManager = `pnpm@${pnpmVersion}`;
for (const section of sections) if (manifest[section]?.pnpm) manifest[section].pnpm = pnpmVersion;
if (manifest.volta) manifest.volta.node = process.versions.node;
save('package.json', manifest);
writeFileSync('.nvmrc', process.versions.node + '\n');
writeFileSync('.node-version', process.versions.node + '\n');
if (pm(['--version'], true) !== pnpmVersion) throw new Error('pnpm version mismatch');

const list = JSON.parse(pm(['-r', 'list', '--depth', '-1', '--json'], true));
const paths = new Set([root, ...list.map(item => resolve(item.path))]);
const workspaces = [...paths].map(path => {
  const workspace = relative(root, path).replaceAll('\\', '/') || '.';
  if (workspace.startsWith('../')) throw new Error('Workspace outside repository');
  return { path, workspace, before: workspace === '.' ? originalRoot : json(resolve(path, 'package.json')) };
});
const deferred = new Map();
const protect = (name, reason) => deferred.set(name, [...(deferred.get(name) ?? []), reason]);
protect('koffi', 'Pinned upstream pending native build and packed-install qualification');
for (const spec of Object.keys(config('patchedDependencies') ?? {})) protect(nameOf(spec), `Version-bound patch: ${spec}`);
for (const spec of Object.keys(config('overrides') ?? {})) {
  for (const part of spec.split('>')) protect(nameOf(part.trim()), `Override: ${spec}`);
}
for (const spec of config('minimumReleaseAgeExclude') ?? []) {
  if (!spec.includes('*')) protect(nameOf(spec), `Reviewed coupled runtime release: ${spec}`);
}
for (const item of workspaces) {
  for (const section of sections) for (const [name, spec] of Object.entries(item.before[section] ?? {})) {
    if (local.test(spec)) continue;
    if (spec.startsWith('npm:')) {
      protect(name, `Platform/package alias: ${spec}`);
      protect(nameOf(spec.slice(4)), `Alias target of ${name}`);
    } else if (!/^(?:[~^<>=*\d]|latest$|catalog:)/.test(spec)) protect(name, `Nonstandard source: ${spec}`);
  }
}
const policyKeys = ['patchedDependencies', 'overrides', 'allowBuilds', 'minimumReleaseAge', 'minimumReleaseAgeExclude', 'strictDepBuilds', 'trustPolicy', 'peerDependencyRules'];
const policies = Object.fromEntries(policyKeys.map(key => [key, config(key)]));
const report = {
  node: process.version, pnpm: pnpmVersion, workspaceCount: workspaces.length,
  status: 'resolving', changes: [],
  deferred: [...deferred].map(([name, reasons]) => ({ name, reasons })),
  scope: 'Ordinary registry dependencies; workspace links, vendored source, peer API ranges and reviewed patched/native groups retained',
};
save('.dsh930/dependency-upgrade.json', report);
try {
  pm(['config', 'set', '--location=project', 'nodeVersion', process.versions.node]);
  pm(['config', 'set', '--location=project', '--json', 'engineStrict', 'true']);
  const recursive = ['--filter', '!./vendor/**', '-r', '--include-workspace-root'];
  pm([...recursive, 'update', '@types/node@24', '--lockfile-only', '--ignore-scripts']);
  pm([...recursive, 'update', '--latest', '--lockfile-only', '--ignore-scripts', '*', '!@types/node', '!pnpm', ...[...deferred.keys()].sort().map(name => `!${name}`)]);
  for (const item of workspaces) {
    const after = json(resolve(item.path, 'package.json'));
    for (const section of sections) for (const [name, from] of Object.entries(item.before[section] ?? {})) {
      const to = after[section]?.[name];
      if (local.test(from) && to !== from) throw new Error(`Workspace link changed: ${item.workspace}/${name}`);
      if (from !== to) report.changes.push({ workspace: item.workspace, section, name, from, to });
    }
    if (item.workspace.startsWith('vendor/') && JSON.stringify(item.before) !== JSON.stringify(after)) throw new Error(`Vendored manifest changed: ${item.workspace}`);
  }
  for (const key of policyKeys) {
    if (JSON.stringify(config(key)) !== JSON.stringify(policies[key])) throw new Error(`Supply-chain policy changed: ${key}`);
  }
  report.status = 'resolved-not-yet-validated';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  throw error;
} finally {
  save('.dsh930/dependency-upgrade.json', report);
}
