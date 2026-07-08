import fs from 'fs';
import path from 'path';
import os from 'os';

// A fake `claude` CLI: reads stdin, emits Claude-Code-style print JSON. Lets us
// test the provider wiring with no subscription and no network.
const tmp = path.join(os.tmpdir(), 'orbit-cc-test-' + process.pid);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const fake = path.join(tmp, 'fake-claude.js');
fs.writeFileSync(fake, `
let input = '';
process.stdin.on('data', d => (input += d));
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: 'ECHO(' + input.length + ')',
    usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3 },
  }));
});
`);

// Must be set BEFORE importing config/providers (bin/model are read at load time).
process.env.CLAUDE_CODE_BIN = 'node "' + fake + '"';

const { getProvider } = await import('../src/providers/index.js');
const { isProviderConfigured } = await import('../src/config.js');

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running Claude Code provider tests...\n');

assert(isProviderConfigured('claude-code'), 'claude-code is configured when the CLI is present');

const p = getProvider('claude-code');
const r = await p.chat({ systemPrompt: 'You are Tester.', messages: [{ role: 'user', content: 'hello' }] });

assert(typeof r.content === 'string' && r.content.startsWith('ECHO('), 'chat returns the CLI result text');
// input = input_tokens(12) + cache_read(3) = 15 ; output = 7 ; total = 22
assert(r.usage.promptTokens === 15 && r.usage.completionTokens === 7 && r.usage.totalTokens === 22, 'usage parsed from CLI JSON (incl. cache tokens)');

console.log('\nClaude Code provider test passed.');
