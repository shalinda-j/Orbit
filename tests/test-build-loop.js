// Stage 4 — Build→Verify loop. Proves runBuild() runs the build loop, checks the result
// against an acceptance command by EXIT CODE, re-runs the team on failure feeding the
// failure back, and only verifies when the tool policy allows commands. Cross-platform
// verify commands via `node -e` (no bash-only builtins). No network.
import { Agent } from '../src/agent.js';
import { Orchestrator } from '../src/orchestrator.js';
import { registerProvider } from '../src/providers/index.js';
import { runCheck } from '../src/tools.js';

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running build→verify loop (Stage 4) tests...\n');

// A single builder agent that always "finishes" and records every prompt it saw.
let builderCalls = 0;
let seenBuilder = [];
registerProvider('bl-builder', {
  name: 'bl-builder',
  async chat({ messages }) {
    builderCalls++;
    seenBuilder.push(JSON.stringify(messages));
    return { content: '[FINISHED] built the thing', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  },
});

const makeOrch = (toolPolicy) => new Orchestrator({
  agents: [new Agent({ name: 'Builder', role: 'Engineer', instructions: 'Build.', provider: 'bl-builder' })],
  supervisorProvider: 'bl-builder',
  toolPolicy,
});

const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(1)"';

// 0. runCheck reports pass/fail by exit code.
assert((await runCheck(PASS)).passed === true, 'runCheck: exit 0 → passed');
assert((await runCheck(FAIL)).passed === false, 'runCheck: non-zero exit → failed');
assert((await runCheck('rm -rf /')).passed === false, 'runCheck: a destructive command is blocked, not run');

// 1. Failing acceptance re-runs the team up to `rounds`, feeding the failure back.
builderCalls = 0; seenBuilder = [];
const failing = await makeOrch('all').runBuild('build a thing', { verifyCmd: FAIL, rounds: 2 });
assert(failing.verify.ran === true, 'verify ran (writes enabled + verify command given)');
assert(failing.verify.passed === false, 'verify reports failure when the command exits non-zero');
assert(failing.verify.rounds === 2, 'the loop retried up to rounds=2 on repeated failure');
assert(builderCalls === 2, 'the build loop ran once per round (2 rounds → 2 builds)');
assert(!seenBuilder[0].includes('previous build attempt FAILED'), 'round 1 has no failure feedback');
// (the command's quotes get JSON-escaped in the recorded messages, so match a quote-free fragment)
assert(seenBuilder[1].includes('previous build attempt FAILED') && seenBuilder[1].includes('process.exit(1)'),
  'round 2 receives the prior failure output as context to fix');
assert(failing.tokenStats.totalTokens === 30 && failing.tokenStats.breakdown.Builder.totalTokens === 30,
  'token stats accumulate across every round (2 × 15)');

// 2. Passing acceptance stops after the first round.
builderCalls = 0; seenBuilder = [];
const passing = await makeOrch('all').runBuild('build a thing', { verifyCmd: PASS, rounds: 3 });
assert(passing.verify.ran && passing.verify.passed === true, 'verify passes when the command exits 0');
assert(passing.verify.rounds === 1, 'a passing check stops the loop after round 1');
assert(builderCalls === 1, 'no needless re-build once acceptance passes');

// 3. Read-only tool policy (plan/safe mode) does NOT run the verify command.
builderCalls = 0; seenBuilder = [];
const readOnly = await makeOrch('read').runBuild('plan a thing', { verifyCmd: FAIL, rounds: 3 });
assert(readOnly.verify.ran === false, 'verify is skipped when commands are blocked by the tool policy');
assert(builderCalls === 1, 'read-only build is a single pass');
assert(readOnly.finalOutput.includes('built the thing'), 'the build result is still returned in read-only mode');

// 4. No verify command → single build pass, no verify metadata claimed.
builderCalls = 0; seenBuilder = [];
const noVerify = await makeOrch('all').runBuild('build a thing', {});
assert(noVerify.verify.ran === false && builderCalls === 1, 'without a verify command it is one plain build pass');

console.log('\nBuild→verify loop (Stage 4) tests passed.');
