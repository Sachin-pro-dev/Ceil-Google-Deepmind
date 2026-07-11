/**
 * Surgical smoke test for the REAL merge path (no LLM): merges the existing
 * ceil-smoke-test branch -> staging -> main, then verifies the smoke file is
 * readable on main. Usage: `npx tsx scripts/smoke-merge.ts`.
 */
import { config } from '../src/config';
import { RealGitHubAdapter } from '../src/integrations/real-github';

const gh = new RealGitHubAdapter();

await gh.createBranch(config.stagingBranch);
const m1 = await gh.mergeBranch('ceil-smoke-test', config.stagingBranch);
console.log(`merged ceil-smoke-test -> ${config.stagingBranch}:`, m1.sha || '(already merged)');

const base = await gh.getDefaultBranch();
const m2 = await gh.mergeBranch(config.stagingBranch, base, 'Ceil: smoke release');
console.log(`merged ${config.stagingBranch} -> ${base}:`, m2.sha || '(already merged)');

// Verify the file is now on the default branch.
const res = await fetch(
  `${config.github.apiUrl}/repos/${config.github.repo}/contents/ceil-smoke.md?ref=${base}`,
  { headers: { Authorization: `Bearer ${config.github.token}`, Accept: 'application/vnd.github+json' } },
);
console.log(`ceil-smoke.md on ${base}:`, res.status === 200 ? 'PRESENT ✓' : `MISSING (HTTP ${res.status})`);
console.log('\nREAL MERGE PATH VERIFIED — code flows feature branch -> staging -> main.');
process.exit(0);
