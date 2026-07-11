/**
 * Surgical smoke test for the REAL GitHub adapter only (no LLM, no Jira/Slack):
 * branch -> commit one file -> open PR -> read checks. Run after fixing token
 * permissions: `npx tsx scripts/smoke-github.ts`.
 */
import { RealGitHubAdapter } from '../src/integrations/real-github';

const gh = new RealGitHubAdapter();
const branch = 'ceil-smoke-test';

const { branch: b } = await gh.createBranch(branch);
console.log('branch ok:', b);
const commit = await gh.commit(b, 'ceil: smoke test', [
  { path: 'ceil-smoke.md', content: `# Ceil smoke test\n\nWritten by the real GitHub adapter.\n` },
]);
console.log('commit ok:', commit.url);
const pr = await gh.openPR({ branch: b, title: 'Ceil smoke test (safe to close)' });
console.log('PR ok:', pr.url);
const checks = await gh.runChecks(pr.number);
console.log('checks ok:', checks);
console.log('\nREAL GITHUB VERIFIED — you can close/delete the smoke PR and branch.');
process.exit(0);
