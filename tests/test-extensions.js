import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolated project dir with a config that declares a manual provider, a plugin, a hook and a skill.
const tmp = path.join(os.tmpdir(), 'orbit-ext-test-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, '.orbit'), { recursive: true });

fs.writeFileSync(path.join(tmp, 'plugin.mjs'), `
export function register(api) {
  api.addDomain({ name: 'greet', help: 'demo', commands: { default: { desc: 'hi', run: async (a, ctx) => ctx.print('hi') } } });
  api.addHook('run.after', async () => { globalThis.__ORBIT_HOOK_FIRED = true; });
  api.addSkill({ name: 'tldr', description: 'summarize', instructions: 'Summarize in 3 bullets.' });
  api.addProvider('pluginllm', { name: 'pluginllm', chat: async () => ({ content: 'x', usage: {} }) });
}
`);

fs.writeFileSync(path.join(tmp, '.orbit', 'config.json'), JSON.stringify({
  providers: [{ name: 'manualllm', baseUrl: 'http://localhost:9/v1', apiKeyEnv: 'MANUAL_KEY', model: 'm1' }],
  plugins: ['./plugin.mjs'],
  hooks: { 'session.start': ['echo hi'] },
  skills: [{ name: 'declared', description: 'a config skill', instructions: 'Do the thing.' }],
}, null, 2));

process.chdir(tmp);

const { extInit, extProviderNames, extDomains, extSkills, emit } = await import('../src/extensions.js');
const { getProvider } = await import('../src/providers/index.js');

function assert(cond, msg) { if (!cond) { console.error('✗ ' + msg); process.exit(1); } console.log('✓ ' + msg); }

console.log('Running extension core tests...\n');
await extInit();

const provNames = extProviderNames();
assert(provNames.includes('manualllm'), 'manual provider registered from config');
assert(provNames.includes('pluginllm'), 'plugin-added provider registered');
assert(getProvider('manualllm')?.baseUrl === 'http://localhost:9/v1', 'manual provider resolvable via getProvider with its base URL');

assert(extDomains().greet?.commands?.default, 'plugin-added domain is available');

const skills = extSkills().map(s => s.name);
assert(skills.includes('declared'), 'config skill loaded');
assert(skills.includes('tldr'), 'plugin skill loaded');

globalThis.__ORBIT_HOOK_FIRED = false;
await emit('run.after', { task: 'x' });
assert(globalThis.__ORBIT_HOOK_FIRED === true, 'plugin hook fires on emit');

console.log('\nExtension core tests passed.');
