import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkVersions } from './check-env.mjs';

const baseline = {
  node: '24.21.0', pnpm: '12.8.1', nvm: '24.21.0', nodeVersion: '24.21.0',
  manager: 'pnpm@12.8.1', desktopPnpm: '12.8.1', dockerfile: 'FROM node:24.21.0-bookworm\n',
};
test('accepts the coordinated toolchain', () => {
  assert.deepEqual(checkVersions(baseline), { node: '24.21.0', pnpm: '12.8.1' });
});
for (const [key, value] of Object.entries({
  node: '22.16.0', nvm: '24.0.0', nodeVersion: '26.0.0', pnpm: '11.7.0',
  manager: 'pnpm@latest', desktopPnpm: '11.7.0', dockerfile: 'FROM node:24-bookworm\n',
})) {
  test(`rejects a mismatched ${key}`, () => {
    assert.throws(() => checkVersions({ ...baseline, [key]: value }));
  });
}
