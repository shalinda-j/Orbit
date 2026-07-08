import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = path.join(os.tmpdir(), 'orbit-feat-test-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.chdir(tmp);

const { config, EFFORT_TURNS, setGlobalEnv, removeGlobalEnv, clearProviderConfig } = await import('../src/config.js');
const { Orchestrator } = await import('../src/orchestrator.js');
const { Agent } = await import('../src/agent.js');
const { registerProvider } = await import('../src/providers/index.js');
const { brainSave, brainSearch } = await import('../src/brain.js');

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running feature tests (effort · disconnect · sub-agents · memory)...\n');

// ── effort ──
assert(EFFORT_TURNS.low === 2 && EFFORT_TURNS.medium === 4 && EFFORT_TURNS.high === 6 && EFFORT_TURNS.max === 10, 'effort → turns mapping');
assert(['low', 'medium', 'high', 'max'].includes(config.effort), 'default effort is valid');

// ── global env set / remove (disconnect) ──
const envFile = path.join(tmp, '.orbit', '.env');
setGlobalEnv('TEST_KEY_X', 'v1');
assert(fs.readFileSync(envFile, 'utf8').includes('TEST_KEY_X=v1'), 'setGlobalEnv persists a key');
removeGlobalEnv('TEST_KEY_X');
assert(!fs.readFileSync(envFile, 'utf8').includes('TEST_KEY_X'), 'removeGlobalEnv deletes the key line');
config.providers.groq.apiKey = 'sk-temp';
clearProviderConfig('groq');
assert(config.providers.groq.apiKey === '', 'clearProviderConfig disconnects live');

// ── sub-agent delegation ──
let subRan = false;
registerProvider('fx', {
  name: 'fx',
  async chat({ messages }) {
    const last = messages.at(-1).content;
    if (last.includes('SUBTASK')) { subRan = true; return { content: 'sub-result-42', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; }
    return {
      content: subRan ? '[FINISHED] done using sub-result-42' : '<tool:subagent role="Researcher">SUBTASK: compute it</tool:subagent>',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  },
});
const main = new Agent({ name: 'Main', role: 'lead', instructions: 'x', provider: 'fx' });
const orch = new Orchestrator({ agents: [main], supervisorProvider: 'fx' });
const messages = [{ role: 'user', content: 'go' }];
const res = await orch.runAgentWithTools(main, messages, null);
assert(subRan, 'main agent spawned a sub-agent');
assert(messages.some(m => m.content.includes('sub-result-42')), "sub-agent's result is fed back to the main agent");
assert(res.content.includes('[FINISHED]'), 'main agent finishes after using the sub-agent');

// ── brain memory: save a run, recall it (self-improvement loop) ──
brainSave({ title: 'Build auth API', content: 'Task: build auth API\nUsed JWT + refresh tokens.', category: 'runs', tags: 'run' });
const recalled = brainSearch({ query: 'build auth', category: 'runs' });
assert(recalled.length === 1 && recalled[0].body.includes('JWT'), 'a saved run is recalled from the brain by topic');
brainSave({ title: 'Unrelated note', content: 'nothing', category: 'notes' });
assert(brainSearch({ query: 'build auth', category: 'runs' }).length === 1, 'recall is scoped to the "runs" category');

// ── write_file shows a compact edit stat, not code ──
let editMsg = '';
registerProvider('fw', {
  name: 'fw',
  async chat({ messages }) {
    const wrote = messages.some(m => m.content.includes('[Tool Output]'));
    return { content: wrote ? '[FINISHED] wrote it' : '<tool:write_file path="hello.txt">line1\nline2</tool:write_file>', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  },
});
const writer = new Agent({ name: 'Writer', role: 'w', instructions: 'x', provider: 'fw' });
const orch2 = new Orchestrator({ agents: [writer], supervisorProvider: 'fw', toolPolicy: 'all' });
await orch2.runAgentWithTools(writer, [{ role: 'user', content: 'go' }], (name, text, thinking) => {
  if (name === 'System' && !thinking && text.startsWith('✎ Edited')) editMsg = text;
});
assert(/^✎ Edited hello\.txt {2}\+2 -0$/.test(editMsg), 'write_file emits a compact "Edited <file> +2 -0" stat (new 2-line file)');
assert(fs.existsSync(path.join(tmp, 'hello.txt')), 'the file was actually written');

console.log('\nFeature tests passed.');
