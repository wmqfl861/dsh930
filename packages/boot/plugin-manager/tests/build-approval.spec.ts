/** Pending script permissions survive cleanup and preserve unrelated workspace settings. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import { parse } from 'yaml'
import { approveBuilds, readPendingBuilds } from '../src/build-approval.ts'

function fixture(text?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'build-approval-'))
  onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
  const filename = join(dir, 'pnpm-workspace.yaml')
  if (text !== undefined) writeFileSync(filename, text)
  return { dir, filename }
}

it('approves only named pending packages and preserves comments, decisions and settings', async () => {
  const { dir, filename } = fixture('# profile settings\nother: &unrelated value\ncopy: *unrelated\nnodeLinker: hoisted\nallowBuilds:\n  native: set this to true or false\n  "@scope/other": set this to true or false\n  trusted: true\n  denied: false\n  "@scope/*": set this to true or false\n')
  expect(await readPendingBuilds(dir)).toEqual(['native', '@scope/other'])
  await approveBuilds(dir, ['native'])
  const text = readFileSync(filename, 'utf8')
  expect(text).toContain('# profile settings')
  expect(parse(text)).toMatchObject({ nodeLinker: 'hoisted', allowBuilds: { native: true, trusted: true, denied: false } })
  expect(await readPendingBuilds(dir)).toEqual(['@scope/other'])
})

it.each(['missing', 'denied', '*', '--all'])('rejects an unlisted approval atomically: %s', async (name) => {
  const original = 'allowBuilds:\n  native: set this to true or false\n  denied: false\n'
  const { dir, filename } = fixture(original)
  await expect(approveBuilds(dir, ['native', name])).rejects.toThrow('stale-approval')
  expect(readFileSync(filename, 'utf8')).toBe(original)
})

it('preserves pnpm file dependency selectors verbatim', async () => {
  const name = '@scope/addon@file:../local addon'
  const { dir, filename } = fixture(`allowBuilds:\n  '${name}': set this to true or false\n`)
  expect(await readPendingBuilds(dir)).toEqual([name])
  await approveBuilds(dir, [name])
  expect(parse(readFileSync(filename, 'utf8'))).toEqual({ allowBuilds: { [name]: true } })
})

it.each([undefined, '{}\n', 'nodeLinker: hoisted\n', 'allowBuilds: {}\n'])('has no pending approval without pnpm placeholders: %s', async (text) => {
  const { dir } = fixture(text)
  expect(await readPendingBuilds(dir)).toEqual([])
  await approveBuilds(dir, [])
})

it.each(['[', '[]\n', 'allowBuilds: false\n'])('rejects malformed workspace settings without rewriting them: %s', async (text) => {
  const { dir, filename } = fixture(text)
  await expect(readPendingBuilds(dir)).rejects.toThrow()
  await expect(approveBuilds(dir, ['native'])).rejects.toThrow()
  expect(readFileSync(filename, 'utf8')).toBe(text)
})

it('reports unreadable workspace settings', async () => {
  const { dir, filename } = fixture()
  mkdirSync(filename)
  await expect(readPendingBuilds(dir)).rejects.toThrow()
})

it.each([
  'allowBuilds:\n  native: &pending set this to true or false\n  other: *pending\n',
  'allowBuilds: &builds\n  native: set this to true or false\nshared: *builds\n',
  'shared: &pending set this to true or false\nallowBuilds:\n  native: *pending\n',
])('rejects shared YAML approval nodes without changing permissions: %s', async (original) => {
  const { dir, filename } = fixture(original)
  await expect(approveBuilds(dir, ['native'])).rejects.toThrow()
  expect(readFileSync(filename, 'utf8')).toBe(original)
})

function layout(dir: string, ignoredBuilds: unknown = ['native@1.0.0'], allowBuilds: unknown = {}) {
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', '.modules.yaml'), JSON.stringify({
    packageManager: 'pnpm@12.8.1', ignoredBuilds, allowBuilds,
  }))
}

it('approves an exact pnpm 12 selector without granting scripts before the decision', async () => {
  const { dir, filename } = fixture('# retained\nnodeLinker: isolated\n')
  layout(dir, ['@scope/native@file:../local addon', 'other@1.0.0'])
  expect(await readPendingBuilds(dir)).toEqual(['@scope/native@file:../local addon', 'other@1.0.0'])
  expect(readFileSync(filename, 'utf8')).not.toContain('allowBuilds')
  await approveBuilds(dir, ['@scope/native@file:../local addon'])
  expect(parse(readFileSync(filename, 'utf8'))).toEqual({
    nodeLinker: 'isolated', allowBuilds: { '@scope/native@file:../local addon': true },
  })
  expect(readFileSync(filename, 'utf8')).toContain('# retained')
  // The first approval changed the policy; a fresh install must establish the remaining decisions.
  await expect(approveBuilds(dir, ['other@1.0.0'])).rejects.toThrow('stale-approval')
})

it('rejects an unknown pnpm 12 approval atomically', async () => {
  const { dir, filename } = fixture('{}\n')
  layout(dir)
  await expect(approveBuilds(dir, ['native@1.0.0', 'missing'])).rejects.toThrow('stale-approval')
  expect(readFileSync(filename, 'utf8')).toBe('{}\n')
})

it('does not use stale layout decisions after a policy edit', async () => {
  const { dir } = fixture('allowBuilds:\n  native: false\n')
  layout(dir)
  expect(await readPendingBuilds(dir)).toEqual([])
  await expect(approveBuilds(dir, ['native@1.0.0'])).rejects.toThrow('stale-approval')
})

it.each(['native', 'native@1.0.0', 'native@^1'])('never overrides a persisted decision for %s', async (key) => {
  const policy = { allowBuilds: { [key]: false } }
  const { dir } = fixture(JSON.stringify(policy))
  layout(dir, ['native@1.0.0'], policy.allowBuilds)
  expect(await readPendingBuilds(dir)).toEqual([])
  await expect(approveBuilds(dir, ['native@1.0.0'])).rejects.toThrow('stale-approval')
})

it.each([false, [12], ['*'], ['--all'], ['native?'], ['bad\nselector']])(
  'rejects malformed pnpm 12 pending selectors: %s', async (ignored) => {
    const { dir, filename } = fixture('{}\n')
    layout(dir, ignored)
    await expect(readPendingBuilds(dir)).rejects.toThrow()
    await expect(approveBuilds(dir, ['native'])).rejects.toThrow()
    expect(readFileSync(filename, 'utf8')).toBe('{}\n')
  },
)
