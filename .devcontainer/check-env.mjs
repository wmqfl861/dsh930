/** Refuse mismatched toolchains before changing the checkout. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Validate the fixed versions shared by the editor, image and workspace. */
export function checkVersions({ node, pnpm, nvm, nodeVersion, manager, desktopPnpm, dockerfile }) {
  assert.equal(node, nvm, 'Active Node does not match .nvmrc');
  assert.equal(nodeVersion, nvm, '.node-version does not match .nvmrc');
  assert.match(node, /^24\./, 'Development requires Node 24');
  assert.equal(manager, `pnpm@${pnpm}`, 'Active pnpm does not match packageManager');
  assert.equal(desktopPnpm, pnpm, 'Desktop carrier pnpm differs from the root');
  assert.ok(dockerfile.includes(`FROM node:${node}-bookworm\n`), 'Docker image does not match Node');
  return { node, pnpm };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const desktop = JSON.parse(readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'));
  const pnpm = execFileSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(pkg.devDependencies.pnpm, pnpm, 'Root pnpm dependency differs from the active tool');
  console.log(JSON.stringify(checkVersions({
    node: process.versions.node, pnpm,
    nvm: readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim(),
    nodeVersion: readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim(),
    manager: pkg.packageManager,
    desktopPnpm: desktop.devDependencies.pnpm,
    dockerfile: readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8'),
  })));
}
