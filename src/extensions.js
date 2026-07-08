import path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { loadConfig } from './orbitconfig.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';
import { registerProvider } from './providers/index.js';

// ─────────────────────────────────────────────
// Extension core: turns the orbit config + plugins into live providers, domains,
// hooks and skills. Everything user-added flows through here.
//   - manual providers  → registered into the provider registry
//   - plugins           → JS modules that call register(api) to add anything
//   - hooks             → shell commands (config) or fns (plugins) run on events
//   - skills            → named, reusable instruction snippets
// ─────────────────────────────────────────────

const reg = { providers: {}, domains: {}, hooks: {}, skills: [] };

function manualProvider(p) {
  return new OpenAICompatibleProvider({
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: p.apiKeyEnv ? (process.env[p.apiKeyEnv] || '') : (p.apiKey || ''),
    defaultModel: p.model || p.defaultModel,
  });
}

function resolvePlugin(spec) {
  // Absolute/relative path → file URL; bare specifier → let Node resolve it.
  if (spec.startsWith('.') || spec.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(spec)) {
    return pathToFileURL(path.resolve(process.cwd(), spec)).href;
  }
  return spec;
}

// The API handed to every plugin's register() function.
function pluginApi() {
  return {
    config: loadConfig(),
    addProvider: (name, instance) => { reg.providers[name] = instance; registerProvider(name, instance); },
    addDomain: (domain) => { if (domain?.name && domain.commands) reg.domains[domain.name] = domain; },
    addHook: (event, fn) => { (reg.hooks[event] ||= []).push(fn); },
    addSkill: (skill) => { if (skill?.name) reg.skills.push(skill); },
    log: (...a) => console.log('  [plugin]', ...a),
  };
}

function runShellHook(command, event, ctx) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, ORBIT_EVENT: event, ORBIT_CONTEXT: JSON.stringify(ctx || {}) },
    });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

let _initPromise = null;
export function extInit() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const cfg = loadConfig();
    const api = pluginApi();

    // 1) manual providers
    for (const p of cfg.providers) {
      if (!p?.name) continue;
      const inst = manualProvider(p);
      reg.providers[p.name] = inst;
      registerProvider(p.name, inst);
    }

    // 2) config shell hooks
    for (const [event, cmds] of Object.entries(cfg.hooks || {})) {
      for (const cmd of (Array.isArray(cmds) ? cmds : [cmds])) {
        (reg.hooks[event] ||= []).push((ctx) => runShellHook(cmd, event, ctx));
      }
    }

    // 3) config skills (declarative {name, description, instructions})
    for (const s of cfg.skills) if (s?.name) reg.skills.push(s);

    // 4) plugins (JS modules)
    for (const spec of cfg.plugins) {
      try {
        const mod = await import(resolvePlugin(spec));
        const register = mod.default?.register || mod.register || (typeof mod.default === 'function' ? mod.default : null);
        if (typeof register === 'function') await register(api);
        else console.error(`  [plugin] ${spec} has no register() export`);
      } catch (e) {
        console.error(`  [plugin] failed to load ${spec}: ${e.message}`);
      }
    }

    return reg;
  })();
  return _initPromise;
}

export const extProviders = () => reg.providers;
export const extProviderNames = () => Object.keys(reg.providers);
export const extDomains = () => reg.domains;
export const extSkills = () => reg.skills;

// Fire an event; runs all subscribed hooks (config shell + plugin fns). Never throws.
export async function emit(event, ctx = {}) {
  await extInit();
  for (const fn of reg.hooks[event] || []) {
    try { await fn(ctx); } catch (e) { console.error(`  [hook:${event}] ${e.message}`); }
  }
}
