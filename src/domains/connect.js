import { config, isProviderConfigured, PROVIDER_NAMES, providerEnv, applyProviderConfig, setGlobalEnv, removeGlobalEnv, clearProviderConfig, setProviderDisabled, isProviderDisabled } from '../config.js';
import { PRESETS } from '../providers/presets.js';
import { addToProjectConfig } from '../orbitconfig.js';
import { extProviderNames } from '../extensions.js';

// How each built-in provider is connected (for the guide).
const NATIVE = {
  'claude-code': { label: 'Claude Code (subscription)', how: 'install Claude Code & log in — no key' },
  openai:        { label: 'OpenAI',    how: 'OPENAI_API_KEY' },
  anthropic:     { label: 'Anthropic', how: 'ANTHROPIC_API_KEY' },
  gemini:        { label: 'Gemini',    how: 'GEMINI_API_KEY' },
  nvidia:        { label: 'NVIDIA Build', how: 'NVIDIA_API_KEY' },
  custom:        { label: 'Custom (any OpenAI-compatible)', how: 'CUSTOM_BASE_URL + CUSTOM_API_KEY + CUSTOM_DEFAULT_MODEL' },
  ollama:        { label: 'Ollama (local)', how: 'run Ollama locally — no key' },
};

function infoFor(name) {
  if (NATIVE[name]) return NATIVE[name];
  const p = PRESETS[name];
  if (p) return { label: p.label, how: `${p.keyEnv}${config.providers[name]?.defaultModel ? ` (model: ${config.providers[name].defaultModel})` : ''}` };
  return { label: name, how: '(manual / plugin provider)' };
}

export default {
  name: 'connect',
  help: 'List AI providers and how to connect each',
  commands: {
    default: {
      desc: 'connect — show every provider and its .env key',
      run: async (a, ctx) => {
        const ext = extProviderNames();
        const names = a._[0] ? [a._[0]] : [...PROVIDER_NAMES, ...ext];
        ctx.print('\n  Providers  (add the key to .env, then restart orbit)');
        for (const name of names) {
          const isExt = ext.includes(name);
          const on = isExt ? true : (config.providers[name] ? isProviderConfigured(name) : false);
          const { label, how } = infoFor(name);
          ctx.print(`   ${on ? '●' : '○'} ${name.padEnd(12)} ${label.padEnd(26)} ${isExt ? 'connected (manual/plugin)' : (on ? 'connected' : how)}`);
        }
        ctx.print('\n  Presets are OpenAI-compatible — just add <NAME>_API_KEY (override with <NAME>_MODEL / <NAME>_BASE_URL).');
        ctx.print('  Add your own:  orbit connect add --name myllm --base-url https://… --key-env MY_KEY --model …\n');
      },
    },
    set: {
      desc: 'Set a provider key non-interactively: connect set <provider> <api-key> [--model M] [--base-url U]',
      run: async (a, ctx) => {
        const name = a._[0];
        const key = a._[1] || a.key;
        if (!name) throw new Error('usage: connect set <provider> <api-key> [--model M]');
        const env = providerEnv(name);
        if (!env) throw new Error(`"${name}" takes no API key (or is unknown) — see \`orbit connect\``);
        if (env.needsBaseUrl && !a['base-url'] && !a.baseUrl) throw new Error('this provider needs --base-url too');
        if (!key) throw new Error('need an API key');
        setGlobalEnv(env.keyEnv, key);
        if (a.model && env.modelEnv) setGlobalEnv(env.modelEnv, a.model);
        const baseUrl = a['base-url'] || a.baseUrl;
        if (baseUrl && env.baseUrlEnv) setGlobalEnv(env.baseUrlEnv, baseUrl);
        applyProviderConfig(name, { key, model: a.model, baseUrl });
        ctx.print(`  ✓ ${name} connected — saved to ~/.orbit/.env`);
      },
    },
    remove: {
      desc: 'Disconnect a provider: connect remove <provider>  (keyless providers like claude-code are turned off)',
      run: async (a, ctx) => {
        const name = a._[0];
        if (!name) throw new Error('usage: connect remove <provider>');
        const env = providerEnv(name);
        if (env) { removeGlobalEnv(env.keyEnv); if (env.baseUrlEnv) removeGlobalEnv(env.baseUrlEnv); }
        clearProviderConfig(name);
        // Keyless providers (claude-code, ollama) stay "configured" after clearing a key — turn them
        // off explicitly so `connect remove claude-code` actually disables the subscription provider.
        if (isProviderConfigured(name)) { setProviderDisabled(name, true); ctx.print(`  ✓ ${name} turned off`); }
        else ctx.print(`  ✓ ${name} disconnected (removed from ~/.orbit/.env)`);
      },
    },
    enable: {
      desc: 'Turn a previously-disabled provider back on: connect enable <provider>',
      run: async (a, ctx) => {
        const name = a._[0];
        if (!name) throw new Error('usage: connect enable <provider>');
        if (!isProviderDisabled(name)) { ctx.print(`  ${name} is not disabled`); return; }
        setProviderDisabled(name, false);
        ctx.print(`  ✓ ${name} re-enabled`);
      },
    },
    add: {
      desc: 'Add a manual OpenAI-compatible provider: connect add --name X --base-url URL --key-env ENV [--model M] [--key LITERAL]',
      run: async (a, ctx) => {
        const name = a.name || a._[0];
        const baseUrl = a['base-url'] || a.baseUrl;
        if (!name || !baseUrl) throw new Error('need --name and --base-url');
        const entry = { name, baseUrl, model: a.model || '' };
        if (a['key-env']) entry.apiKeyEnv = a['key-env'];
        if (a.key) entry.apiKey = a.key; // note: stored in .orbit/config.json — prefer --key-env for secrets
        const f = addToProjectConfig('providers', entry);
        ctx.print(`  ✓ added provider "${name}" → ${f}`);
        ctx.print(`    restart orbit to use it${entry.apiKeyEnv ? ` (set ${entry.apiKeyEnv} in your env)` : ''}.`);
      },
    },
  },
};
