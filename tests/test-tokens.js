// Token-reduction controls: max-token cap, lazy mode, single-agent synthesis skip.
import { config, maxTokens } from '../src/config.js';
import { Agent } from '../src/agent.js';
import { Orchestrator } from '../src/orchestrator.js';
import { registerProvider } from '../src/providers/index.js';

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running token-control tests...\n');

// max-token cap + lazy tightening
config.lazy = false;
config.limits.maxTokens = 4096;
assert(maxTokens() === 4096, 'maxTokens() returns the configured cap');
config.limits.maxTokens = 800;
assert(maxTokens() === 800, '/tokens-style override lowers the cap');
config.limits.maxTokens = 4096;
config.lazy = true;
assert(maxTokens() === 1024, 'lazy mode hard-caps output at 1024');
config.limits.maxTokens = 500;
assert(maxTokens() === 500, 'lazy uses the lower of (cap, 1024)');

// lazy directive reaches the provider's system prompt
config.lazy = true;
let sawLazy = '';
registerProvider('probe', { name: 'probe', async chat({ systemPrompt }) { sawLazy = systemPrompt; return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; } });
await new Agent({ name: 'A', role: 'r', instructions: 'do', provider: 'probe' }).respond([{ role: 'user', content: 'hi' }]);
assert(/LAZY MODE/.test(sawLazy), 'lazy mode injects the token-frugal directive into the agent prompt');
config.lazy = false;

// single-agent run skips the synthesizer (saves a call)
let calls = 0;
registerProvider('solo', { name: 'solo', async chat() { calls++; return { content: '[FINISHED] done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; } });
const one = new Agent({ name: 'Solo', role: 'r', instructions: 'do', provider: 'solo' });
const orch = new Orchestrator({ agents: [one], supervisorProvider: 'solo' });
const res = await orch.runCollaborative('task', 3, () => {});
assert(res.finalOutput.includes('done'), 'single-agent run returns the agent output as the final product');
// 1 agent turn only — no separate synthesizer call (selectNextSpeaker is skipped for 1 agent, synthesis skipped)
assert(calls === 1, 'single-agent run makes exactly one model call (synthesizer skipped)');

console.log('\nToken-control tests passed.');
