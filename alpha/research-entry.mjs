import { AlphaRunner } from './runner.mjs';

/**
 * DSH-native research pair entry point.
 * Reuses AlphaRunner and the caller-provided DSH executor.
 * It intentionally does not create a parallel runner or enable live calls.
 */
export async function runResearchPair({ team, skills, revision, config, executor, store, brief, signal }) {
  const runner = new AlphaRunner({ team, skills, revision, config, executor, store });
  runner.team.roles = runner.team.roles
    .filter(role => role.id === 'research')
    .map(role => ({ ...role, dependsOn: [] }));
  return runner.run(brief, signal);
}
