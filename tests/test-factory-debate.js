// Phase 2 · agent-to-agent design debate. Proves the debate consensus path: competing
// architect proposals → critic → judge, all recorded to the debate store, converging on
// one design the rest of the pipeline builds. Runs in a throwaway cwd. No network.
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-factory-debate-'));
process.chdir(tmp);

const { registerProvider } = await import('../src/providers/index.js');
const { runFactory } = await import('../src/factory.js');
const { readStore } = await import('../src/store.js');

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}
const usage = { promptTokens: 6, completionTokens: 4, totalTokens: 10 };
const json = (o) => ({ content: JSON.stringify(o), usage });

let architectCalls = 0, judgeCalls = 0;
registerProvider('deb', {
  name: 'deb',
  async chat({ systemPrompt }) {
    if (systemPrompt.includes('Intake Analyst'))
      return json({ goal: 'Build a URL shortener', constraints: [], acceptance: ['redirects work'], nonGoals: [] });
    if (systemPrompt.includes('Lead Architect')) {
      architectCalls++;
      // two competing proposals — each still yields a buildable task list
      return json({
        overview: `Proposal ${architectCalls}`, architecture: 'api + store', dataModel: 'link(slug,url)',
        diagram: 'graph TD; A-->B',
        tasks: [
          { title: 'Store', detail: 'link store', acceptance: 'save/lookup' },
          { title: 'API', detail: 'shorten + redirect endpoints', acceptance: '302 redirect' },
        ],
      });
    }
    if (systemPrompt.includes('You are the judge')) { judgeCalls++; return { content: '1', usage }; }
    if (systemPrompt.includes('design critic')) return { content: '#2 is thinner; #1 most buildable.', usage };
    if (systemPrompt.includes('Genesis Orchestrator'))
      return { content: JSON.stringify([{ name: 'Coder', role: 'Engineer', instructions: 'code', provider: 'deb', model: 'm' }]), usage };
    return { content: '[FINISHED] built', usage };
  },
});

console.log('Running factory design-debate (Phase 2) tests...\n');

const res = await runFactory({
  goal: 'make a url shortener',
  providerName: 'deb',
  providers: ['deb'],
  substrate: 'inprocess',
  designMode: 'debate',
  verifyCmd: 'node -e "process.exit(0)"',
  onPhase: () => {}, onLog: () => {},
});

// 1. Debate mode ran two competing architects + a judge.
assert(architectCalls >= 2, 'two competing architect proposals were generated');
assert(judgeCalls === 1, 'the judge was consulted once to pick the winner');
assert(res.debateId, 'a debate id is returned from the run');

// 2. The debate was recorded to the shared store (inspectable via `orbit debate show`).
const store = readStore();
const debate = store.debates.find(d => d.id === res.debateId);
assert(debate && debate.status === 'closed', 'the debate is recorded and closed');
assert(debate.proposals.length === 2, 'both proposals are recorded');
assert(debate.critiques.length === 1, 'the critique is recorded');
assert(/Chose Architect/.test(debate.verdict), 'the judge verdict is recorded');

// 3. The chosen design still drove the rest of the pipeline to a verified build.
assert(res.design.tasks.length === 2, 'the winning design has a task breakdown');
assert(res.buildResults.length === 2, 'every task was built in-process');
assert(res.verify.ran && res.verify.passed, 'the whole project verified after the debate-chosen build');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

console.log('\nFactory design-debate (Phase 2) tests passed.');
