import { AlphaRunner } from './runner.mjs';

/**
 * DSH-native research pair entry point.
 * Reuses AlphaRunner with the caller's loaded roster, config, executor and store.
 * Only research/shadow run. Fixture mode returns fixture_complete; DSH mode
 * returns research_reviewed with qualityAcceptanceGranted=false. Configuration
 * must explicitly permit execution; this entry never enables live calls.
 */
export async function runResearchPair({ team, skills, revision, config, executor, store, brief, signal }) {
  const runner = new AlphaRunner({ team, skills, revision, config, executor, store, executionScope: 'research-pair' });
  return runner.run(brief, signal);
}
