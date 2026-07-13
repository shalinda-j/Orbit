// The Conductor (factory.js) — end-to-end. Proves the autonomous pipeline chains all five
// phases (discover → design → decompose → build → integrate), writes artifacts, seeds the
// shared board, builds every task in-process, and verifies the whole project. No network.
// Runs in a throwaway cwd so the .orbit store/artifacts don't touch the repo.
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-factory-'));
process.chdir(tmp);

const { registerProvider } = await import('../src/providers/index.js');
const { runFactory } = await import('../src/factory.js');
const { readStore } = await import('../src/store.js');

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}
const json = (o) => ({ content: JSON.stringify(o), usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });

// One fake provider that plays every role, routed by its system prompt.
let builderTurns = 0;
registerProvider('facto', {
  name: 'facto',
  async chat({ systemPrompt }) {
    if (systemPrompt.includes('Intake Analyst'))
      return json({ goal: 'Build a CLI todo app', constraints: ['Node.js'], acceptance: ['npm test passes'], nonGoals: [] });
    if (systemPrompt.includes('Lead Architect'))
      return json({
        overview: 'A tiny CLI todo app.',
        architecture: 'store.js + cli.js',
        dataModel: 'todo(id, text, done)',
        diagram: 'graph TD; CLI-->Store',
        tasks: [
          { title: 'Store', detail: 'implement the todo store', acceptance: 'add/list works' },
          { title: 'CLI', detail: 'wire the CLI commands', acceptance: 'orbit todo add works' },
        ],
      });
    if (systemPrompt.includes('design critic')) return { content: 'APPROVED', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
    if (systemPrompt.includes('Genesis Orchestrator'))
      return { content: JSON.stringify([{ name: 'Coder', role: 'Engineer', instructions: 'code', provider: 'facto', model: 'm' }]), usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } };
    builderTurns++;
    return { content: '[FINISHED] built the piece', usage: { promptTokens: 8, completionTokens: 6, totalTokens: 14 } };
  },
});

console.log('Running Conductor / factory (end-to-end) tests...\n');

const phases = [];
const res = await runFactory({
  goal: 'make me a todo cli',
  providerName: 'facto',
  providers: ['facto'],
  substrate: 'inprocess',
  verifyCmd: 'node -e "process.exit(0)"',
  onPhase: (k) => phases.push(k),
  onLog: () => {},
});

// 1. Discovery produced a refined spec.
assert(res.brief.goal === 'Build a CLI todo app', 'Phase 1: discovery refined the raw ask into a spec');
assert(res.brief.acceptance.includes('npm test passes'), 'Phase 1: acceptance criteria captured');

// 2. Design produced artifacts + a task breakdown.
assert(res.design.tasks.length === 2, 'Phase 2: architect produced a 2-task breakdown');
assert(fs.existsSync(path.join(res.artifactsDir, 'plan.md')), 'Phase 2: plan.md artifact written');
assert(fs.existsSync(path.join(res.artifactsDir, 'design.json')), 'Phase 2: design.json artifact written');
const plan = fs.readFileSync(path.join(res.artifactsDir, 'plan.md'), 'utf8');
assert(plan.includes('# Build a CLI todo app') && plan.includes('```mermaid'), 'Phase 2: plan.md has the goal + a mermaid diagram');

// 3. Decompose seeded the shared board (parent + one child per task).
const store = readStore();
assert(store.tasks.length === 3, 'Phase 3: board seeded with 1 parent + 2 child tasks');
const children = store.tasks.filter(t => t.parentId === res.taskIds.parentId);
assert(children.length === 2 && children.every(t => t.status === 'done'), 'Phase 3/4: every child task ended up done');
assert(store.tasks.find(t => t.id === res.taskIds.parentId).status === 'done', 'parent task closes when build+verify pass');

// 4. Build ran the team once per task.
assert(res.buildResults.length === 2, 'Phase 4: built both tasks in-process');
assert(builderTurns >= 2, 'Phase 4: the build team actually ran per task');

// 5. Whole-project verification ran and passed.
assert(res.verify.ran && res.verify.passed && res.verify.rounds === 1, 'Phase 5: whole-project acceptance verified');

// 6. All five phases fired in order.
for (const p of ['discover', 'design', 'decompose', 'build', 'integrate', 'done'])
  assert(phases.includes(p), `pipeline reached the "${p}" phase`);

// cleanup (best effort)
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

console.log('\nConductor / factory (end-to-end) tests passed.');
