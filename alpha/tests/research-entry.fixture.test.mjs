import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearchPair } from '../research-entry.mjs';

function fixtureExecutor(mode = 'ok') {
  return {
    mode: 'dsh',
    async preflight() {},
    async execute({ phase }) {
      if (mode === 'fail' && phase === 'draft') throw new Error('fixture failure');
      if (mode === 'cancel' && phase === 'prepare') return await new Promise(() => {});
      if (phase === 'prepare') return { sources: [], coverage: ['research scope'], checks: ['source check'], uncertainties: [] };
      if (phase === 'draft') return { sources: [], summary: 'fixture research', artifact: { candidate: true }, alternatives: ['fixture'], openQuestions: [], experiments: [] };
      return { sources: [], subjectHash: arguments[0]?.subjectHash ?? '', verdict: 'pass', findings: [], checked: ['fixture review'] };
    }
  };
}

test('research pair fixture succeeds without live model calls', async () => {
  const result = await runResearchPair({ executor: fixtureExecutor(), brief: { goal: 'research', acceptance: ['reviewed'] } });
  assert.equal(result.status, 'reviewed');
});

test('research pair fixture cancellation does not accept', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => runResearchPair({ executor: fixtureExecutor('cancel'), signal: controller.signal, brief: { goal: 'research', acceptance: ['reviewed'] } }));
});

test('research pair fixture failure blocks acceptance', async () => {
  await assert.rejects(() => runResearchPair({ executor: fixtureExecutor('fail'), brief: { goal: 'research', acceptance: ['reviewed'] } }));
});
