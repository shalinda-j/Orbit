// Verify preset OpenAI-compatible providers wire up correctly (no network).
process.env.OPENROUTER_API_KEY = 'sk-test-123';
process.env.ZAI_MODEL = 'glm-4.6-custom';

const { config, isProviderConfigured, PROVIDER_NAMES } = await import('../src/config.js');
const { getProvider } = await import('../src/providers/index.js');
const { PRESETS } = await import('../src/providers/presets.js');

function assert(cond, msg) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1); }
  console.log('✓ ' + msg);
}

console.log('Running provider preset tests...\n');

// All presets are registered and resolvable.
for (const name of Object.keys(PRESETS)) {
  assert(getProvider(name)?.name === name, `getProvider("${name}") returns its instance`);
}

// Presets appear in the canonical order and have baked-in base URLs.
assert(PROVIDER_NAMES.includes('openrouter') && PROVIDER_NAMES.includes('kimi') && PROVIDER_NAMES.includes('zai'), 'presets are in PROVIDER_NAMES');
assert(config.providers.openrouter.baseUrl === 'https://openrouter.ai/api/v1', 'openrouter base URL baked in');
assert(config.providers.kimi.baseUrl.startsWith('https://api.moonshot'), 'kimi base URL baked in');

// Configured only when a key is present.
assert(isProviderConfigured('openrouter') === true, 'openrouter configured (key set)');
assert(isProviderConfigured('groq') === false, 'groq not configured (no key)');

// *_MODEL env overrides the baked-in default.
assert(config.providers.zai.defaultModel === 'glm-4.6-custom', 'ZAI_MODEL overrides the default model');

// The generic provider throws a clear error when its key is missing (no network hit).
let threw = false;
try { await getProvider('groq').chat({ messages: [{ role: 'user', content: 'hi' }] }); }
catch (e) { threw = /API key not set/.test(e.message); }
assert(threw, 'unconfigured preset fails fast with a clear message');

console.log('\nProvider preset tests passed.');
