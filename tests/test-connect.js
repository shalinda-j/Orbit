import fs from 'fs';
import path from 'path';
import os from 'os';

// Redirect os.homedir() to a temp dir so the global ~/.orbit/.env write doesn't touch the real home.
const tmp = path.join(os.tmpdir(), 'orbit-connect-test-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;

const { config, providerEnv, applyProviderConfig, upsertEnvLine } = await import('../src/config.js');
const { loadDomains } = await import('../src/cli.js');

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running provider-onboarding tests...\n');

// upsertEnvLine — append vs replace
assert(upsertEnvLine('', 'K', 'v') === 'K=v\n', 'upsert appends into empty file');
assert(upsertEnvLine('A=1\n', 'K', 'v') === 'A=1\nK=v\n', 'upsert appends, preserving existing lines');
assert(upsertEnvLine('K=old\nA=1\n', 'K', 'new') === 'K=new\nA=1\n', 'upsert replaces an existing key in place');

// providerEnv — native / preset / keyless
assert(providerEnv('openai').keyEnv === 'OPENAI_API_KEY', 'providerEnv resolves a native provider');
assert(providerEnv('qwen').keyEnv === 'DASHSCOPE_API_KEY', 'providerEnv resolves a preset (Qwen → DASHSCOPE_API_KEY)');
assert(providerEnv('custom').needsBaseUrl === true, 'providerEnv flags custom as needing a base URL');
assert(providerEnv('claude-code') === null && providerEnv('ollama') === null, 'keyless providers return null');

// applyProviderConfig — live, no restart
applyProviderConfig('groq', { key: 'sk-live', model: 'llama-x' });
assert(config.providers.groq.apiKey === 'sk-live' && config.providers.groq.defaultModel === 'llama-x', 'applyProviderConfig updates the live config');

// `connect set` — persists to global .env AND applies live
const d = await loadDomains();
const out = [];
const ctx = { print: (...a) => out.push(a.join(' ')), cwd: tmp };
await d.connect.commands.set.run({ _: ['deepseek', 'sk-ds'], model: 'deepseek-coder' }, ctx);
const content = fs.readFileSync(path.join(tmp, '.orbit', '.env'), 'utf8');
assert(content.includes('DEEPSEEK_API_KEY=sk-ds') && content.includes('DEEPSEEK_MODEL=deepseek-coder'), 'connect set writes the key+model to ~/.orbit/.env');
assert(config.providers.deepseek.apiKey === 'sk-ds', 'connect set applies the provider live');

let threw = false;
try { await d.connect.commands.set.run({ _: ['claude-code', 'x'] }, ctx); } catch { threw = true; }
assert(threw, 'connect set rejects a keyless provider');

console.log('\nProvider-onboarding tests passed.');
