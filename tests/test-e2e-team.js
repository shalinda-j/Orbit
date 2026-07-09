// E2E proof of the core vision: different providers/models on different agents,
// working as one team — coordinator routing, cross-agent communication (each agent
// sees the others' messages), tool use mid-run, and final synthesis. No network.
import { Agent } from '../src/agent.js';
import { Orchestrator } from '../src/orchestrator.js';
import { registerProvider } from '../src/providers/index.js';

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

// Three fake providers that behave like different vendors' models.
// Each records what it saw, so we can prove cross-provider communication.
const seen = { alpha: [], beta: [], gamma: [], supervisor: [] };
const usage = (p, c) => ({ promptTokens: p, completionTokens: c, totalTokens: p + c });

registerProvider('fake-alpha', { // "planner model"
  name: 'fake-alpha',
  async chat({ systemPrompt, messages }) {
    seen.alpha.push({ systemPrompt, messages });
    return { content: 'PLAN: 1) write add(a,b) 2) test it', usage: usage(10, 5) };
  },
});

let betaCalls = 0;
registerProvider('fake-beta', { // "coder model" — uses a tool on its first call
  name: 'fake-beta',
  async chat({ systemPrompt, messages }) {
    seen.beta.push({ systemPrompt, messages });
    betaCalls++;
    if (betaCalls === 1) return { content: '<tool:list_dir path="." />', usage: usage(20, 5) };
    return { content: 'CODE: function add(a,b){return a+b}   // per Planner’s PLAN', usage: usage(22, 8) };
  },
});

registerProvider('fake-gamma', { // "reviewer model"
  name: 'fake-gamma',
  async chat({ systemPrompt, messages }) {
    seen.gamma.push({ systemPrompt, messages });
    return { content: '[FINISHED] Review passed: CODE matches PLAN.', usage: usage(30, 6) };
  },
});

// Supervisor provider: routes Planner -> Coder -> Reviewer, then synthesizes.
let supCalls = 0;
registerProvider('fake-supervisor', {
  name: 'fake-supervisor',
  async chat({ systemPrompt, messages }) {
    seen.supervisor.push({ systemPrompt, messages });
    supCalls++;
    if (systemPrompt.includes('Synthesizer')) {
      return { content: 'FINAL PRODUCT: add(a,b) implemented, reviewed, done.', usage: usage(40, 10) };
    }
    const order = ['Planner', 'Coder', 'Reviewer'];
    return { content: order[Math.min(supCalls - 1, 2)], usage: usage(5, 2) };
  },
});

console.log('Running multi-provider team e2e test...\n');

// One team, three DIFFERENT providers (like gemini + deepseek + kimi in real use).
const team = [
  new Agent({ name: 'Planner', role: 'Architect', instructions: 'Plan.', provider: 'fake-alpha', model: 'alpha-1' }),
  new Agent({ name: 'Coder', role: 'Engineer', instructions: 'Code.', provider: 'fake-beta', model: 'beta-9' }),
  new Agent({ name: 'Reviewer', role: 'QA', instructions: 'Review.', provider: 'fake-gamma', model: 'gamma-x' }),
];
const orch = new Orchestrator({ agents: team, supervisorProvider: 'fake-supervisor' });

const spoke = [];
const result = await orch.runCollaborative('Build an add function', 6, (name, text, thinking) => {
  if (!thinking && !['System'].includes(name)) spoke.push(name);
});

// 1. Every agent (on its own provider) participated, in coordinator order.
assert(seen.alpha.length === 1 && seen.beta.length >= 1 && seen.gamma.length === 1,
  'all three providers were called (one per agent)');
assert(spoke.join(',').includes('Planner') && spoke.join(',').includes('Coder') && spoke.join(',').includes('Reviewer'),
  'coordinator routed Planner → Coder → Reviewer across providers');

// 2. Cross-provider communication: the Coder (beta) saw the Planner's PLAN,
//    and the Reviewer (gamma) saw both PLAN and CODE.
const betaSaw = JSON.stringify(seen.beta.at(-1).messages);
const gammaSaw = JSON.stringify(seen.gamma[0].messages);
assert(betaSaw.includes('PLAN'), 'Coder (provider B) received Planner’s output (provider A)');
assert(gammaSaw.includes('PLAN') && gammaSaw.includes('CODE'), 'Reviewer (provider C) received both prior agents’ work');

// 3. Agents argue/communicate with identity: other agents’ messages are attributed by @handle.
assert(gammaSaw.includes('@planner') && gammaSaw.includes('@coder'), 'messages are attributed by @handle');

// 4. Tool use mid-run worked (beta called list_dir and got output back).
assert(betaCalls === 2 && betaSaw.includes('[Tool Output'), 'agent used a workspace tool mid-run and saw the result');

// 5. [FINISHED] ended the run before maxTurns, and synthesis combined the work.
assert(result.finalOutput.includes('FINAL PRODUCT'), 'synthesizer produced the final combined product');

// 6. Token accounting per agent, across different providers.
const b = result.tokenStats.breakdown;
assert(b.Planner && b.Coder && b.Reviewer && b.Synthesizer, 'per-agent token breakdown covers every provider');
assert(result.tokenStats.totalTokens > 0, 'total token accounting works');

// 7. Each agent got its own persona (different system prompts per provider).
assert(seen.alpha[0].systemPrompt.includes('Planner') && seen.gamma[0].systemPrompt.includes('Reviewer'),
  'each agent carries its own persona to its own provider');

// 8. Sequential style also chains across providers.
seen.alpha.length = 0; seen.beta.length = 0; seen.gamma.length = 0; betaCalls = 1; // skip beta tool turn
const seq = await orch.runSequential('Build multiply', () => {});
assert(JSON.stringify(seen.gamma[0].messages).includes('CODE'), 'sequential mode passes provider B’s output to provider C');
assert(seq.finalOutput.length > 0, 'sequential chain produces a final output');

console.log('\nMulti-provider team e2e test passed.');
