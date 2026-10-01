/** Approve pnpm's pending dependency scripts in the current profile's workspace settings. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit } from 'yaml'
import { ManagementFailure } from './failure.ts'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

async function readPolicy(dir: string) {
  let text: string
  try { text = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    text = '{}\n'
  }
  const document = parseDocument(text)
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isMap(document.contents)) throw new Error('pnpm-workspace.yaml must be a YAML mapping')
  const builds = document.get('allowBuilds')
  if (builds !== undefined && !isMap(builds)) throw new Error('allowBuilds must be a YAML mapping')
  visit(builds ?? null, (_key, node) => {
    if (isAlias(node) || (isNode(node) && 'anchor' in node && node.anchor)) {
      throw new Error('allowBuilds must not contain YAML anchors or aliases')
    }
  })
  const pending = isMap(builds) ? builds.items.flatMap(({ key, value }) =>
    isScalar(key) && typeof key.value === 'string' && !/[*?]/.test(key.value)
      && isScalar(value) && value.value === 'set this to true or false' ? [key.value] : []) : []
  return { document, builds, pending }
}

/** pnpm 12 records undecided scripts in the installation layout, not the workspace policy. */
async function layoutPendingBuilds(dir: string, policy: Awaited<ReturnType<typeof readPolicy>>): Promise<string[]> {
  let text: string
  try { text = await readFile(join(dir, 'node_modules', '.modules.yaml'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
  const layout = parseDocument(text)
  if (layout.errors[0] !== undefined) throw layout.errors[0]
  if (!isMap(layout.contents)) throw new Error('pnpm installation layout must be a YAML mapping')
  const manager = layout.get('packageManager')
  if (typeof manager !== 'string' || !/^pnpm@12\./.test(manager)) return []
  const ignored = layout.get('ignoredBuilds')
  if (ignored === undefined) return []
  if (!isSeq(ignored)) throw new Error('pnpm ignoredBuilds must be a sequence')
  const recorded = layout.get('allowBuilds')
  if (recorded !== undefined && !isMap(recorded)) throw new Error('pnpm recorded allowBuilds must be a mapping')
  // Any policy edit invalidates the layout's decisions until another installation records them.
  if (!isDeepStrictEqual(recorded?.toJSON() ?? {}, policy.builds?.toJSON() ?? {})) return []
  return ignored.items.map((item) => {
    if (!isScalar(item) || typeof item.value !== 'string' || item.value === ''
      || /[*?\r\n\0]/.test(item.value) || item.value.startsWith('-')) {
      throw new Error('pnpm ignoredBuilds must contain exact package selectors')
    }
    return item.value
  }).filter((selector) => {
    const separator = selector.indexOf('@', 1)
    const name = separator > 0 ? selector.slice(0, separator) : selector
    // Never turn an existing decision, including a version-qualified decision, into a new approval.
    return !isMap(policy.builds) || !policy.builds.items.some(({ key, value }) =>
      isScalar(key) && typeof key.value === 'string' && isScalar(value) && typeof value.value === 'boolean'
        && (key.value === name || key.value.startsWith(`${name}@`)))
  })
}

/** Read pnpm 11 policy placeholders and pnpm 12 installation-layout decisions after cleanup.
 * @param dir Current profile directory.
 * @returns Exact package selectors awaiting a build decision; wildcard rules are excluded.
 */
export async function readPendingBuilds(dir: string): Promise<string[]> {
  const policy = await readPolicy(dir)
  return [...new Set([...policy.pending, ...await layoutPendingBuilds(dir, policy)])]
}

/** Persist approval without running scripts; the caller holds the profile manifest lock.
 * @param dir Current profile directory.
 * @param names Explicit package selectors from the pending build list.
 * @throws If a selector is no longer pending or the policy is malformed; no approvals are written.
 */
export async function approveBuilds(dir: string, names: readonly string[]): Promise<void> {
  const policy = await readPolicy(dir)
  const pending = [...policy.pending, ...await layoutPendingBuilds(dir, policy)]
  if (names.some(name => !pending.includes(name))) throw new ManagementFailure('stale-approval')
  if (names.length === 0) return
  for (const name of names) policy.document.setIn(['allowBuilds', name], true)
  await writeFileAtomic(join(dir, 'pnpm-workspace.yaml'), String(policy.document), { mode: 0o600 })
}
