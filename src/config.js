import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import { PRESETS, baseUrlEnv } from './providers/presets.js';

// Load .env: project (cwd) first (highest precedence), then a global ~/.orbit/.env fallback
// so keys entered once via `orbit connect` persist across every project.
dotenv.config({ quiet: true });
export const globalEnvFile = () => path.join(os.homedir(), '.orbit', '.env');
dotenv.config({ path: globalEnvFile(), quiet: true }); // won't override vars already set by cwd .env

export const config = {
  providers: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      defaultModel: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      defaultModel: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL || 'claude-3-5-haiku-20241022',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      defaultModel: process.env.OLLAMA_DEFAULT_MODEL || 'llama3',
    },
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY || '',
      baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      defaultModel: process.env.NVIDIA_DEFAULT_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
    },
    // Generic OpenAI-compatible endpoint — connect any provider (OpenRouter, Groq, vLLM, LM Studio, ...)
    custom: {
      apiKey: process.env.CUSTOM_API_KEY || '',
      baseUrl: process.env.CUSTOM_BASE_URL || '',
      defaultModel: process.env.CUSTOM_DEFAULT_MODEL || '',
    },
    // Runs through the local Claude Code CLI — uses your subscription, no API key.
    'claude-code': {
      bin: process.env.CLAUDE_CODE_BIN || 'claude',
      model: process.env.CLAUDE_CODE_MODEL || '',
    },
  }
};

// Fold in every OpenAI-compatible preset (OpenRouter, z.ai, Kimi, Groq, DeepSeek, ...).
// Each is "configured" once its <NAME>_API_KEY is set; base URL & model have baked-in defaults.
for (const [name, p] of Object.entries(PRESETS)) {
  config.providers[name] = {
    baseUrl: process.env[baseUrlEnv(p.keyEnv)] || p.baseUrl,
    apiKey: process.env[p.keyEnv] || '',
    defaultModel: process.env[p.modelEnv] || p.defaultModel,
  };
}

// ── Token / laziness controls (mutable: the TUI /lazy and /tokens toggles change these live) ──
config.limits = { maxTokens: parseInt(process.env.ORBIT_MAX_TOKENS, 10) || 4096 };
config.lazy = process.env.ORBIT_LAZY === '1' || process.env.ORBIT_LAZY === 'true';
config.animate = process.env.ORBIT_ANIM !== '0'; // animate the team conversation (TUI only)
// Stage 0 intake: refine the raw prompt into a build brief before designing the team.
// On by default; set ORBIT_INTAKE=0 to skip the extra call and use the prompt as-is.
config.intake = process.env.ORBIT_INTAKE !== '0' && process.env.ORBIT_INTAKE !== 'false';

// Reasoning effort: how hard the team works (deeper = more turns + more deliberation).
export const EFFORT_TURNS = { low: 2, medium: 4, high: 6, max: 10 };
config.effort = EFFORT_TURNS[process.env.ORBIT_EFFORT] ? process.env.ORBIT_EFFORT : 'medium';
config.useProviders = []; // when non-empty, restrict runs to this subset of providers (multi-model select)
// Providers the user has explicitly turned off — even keyless ones (claude-code, ollama) that are
// otherwise always "configured". Lets `/disconnect claude-code` actually take effect.
config.disabled = String(process.env.ORBIT_DISABLED_PROVIDERS || '').split(/[\s,]+/).filter(Boolean);

// Effective output-token cap for a call. Lazy "lazy" mode tightens it hard to slash token spend.
export function maxTokens() {
  return config.lazy ? Math.min(config.limits.maxTokens, 1024) : config.limits.maxTokens;
}

// Canonical provider order for banners / preference (subscription first → keyed APIs → presets → local).
export const PROVIDER_NAMES = [
  'claude-code', 'openai', 'anthropic', 'gemini', 'nvidia',
  ...Object.keys(PRESETS),
  'custom', 'ollama',
];

// Is the Claude Code CLI available? (cached — resolving PATH spawns a process)
let _ccAvailable = null;
function claudeCodeAvailable() {
  if (process.env.CLAUDE_CODE_BIN) return true; // explicitly pointed at a binary
  if (_ccAvailable !== null) return _ccAvailable;
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    _ccAvailable = spawnSync(finder, ['claude'], { stdio: 'ignore' }).status === 0;
  } catch { _ccAvailable = false; }
  return _ccAvailable;
}

// Check if provider is configured
export function isProviderConfigured(providerName) {
  if (config.disabled.includes(providerName)) return false; // explicitly turned off by the user
  const prov = config.providers[providerName];
  if (!prov) return false;
  if (providerName === 'ollama') return true;            // local, doesn't strictly need a key
  if (providerName === 'custom') return !!prov.baseUrl;  // key optional (local endpoints), URL required
  if (providerName === 'claude-code') return claudeCodeAvailable(); // subscription via the `claude` CLI
  return !!prov.apiKey;
}

// ── Provider onboarding (used by the `/connect` wizard and `orbit connect set`) ──
// Which env vars hold each provider's key / model (native providers; presets come from PRESETS).
const NATIVE_ENV = {
  openai:    { keyEnv: 'OPENAI_API_KEY',    modelEnv: 'OPENAI_DEFAULT_MODEL' },
  anthropic: { keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_DEFAULT_MODEL' },
  gemini:    { keyEnv: 'GEMINI_API_KEY',    modelEnv: 'GEMINI_DEFAULT_MODEL' },
  nvidia:    { keyEnv: 'NVIDIA_API_KEY',    modelEnv: 'NVIDIA_DEFAULT_MODEL' },
  custom:    { keyEnv: 'CUSTOM_API_KEY',    modelEnv: 'CUSTOM_DEFAULT_MODEL', baseUrlEnv: 'CUSTOM_BASE_URL', needsBaseUrl: true },
};

// Env-var descriptor for a provider, or null for keyless providers (claude-code, ollama).
export function providerEnv(name) {
  if (NATIVE_ENV[name]) return NATIVE_ENV[name];
  const p = PRESETS[name];
  if (p) return { keyEnv: p.keyEnv, modelEnv: p.modelEnv, baseUrlEnv: baseUrlEnv(p.keyEnv) };
  return null;
}

// Apply a provider's key/model/baseUrl to the live config so it works this session (no restart).
export function applyProviderConfig(name, { key, model, baseUrl } = {}) {
  const p = config.providers[name];
  if (!p) return;
  if (key) p.apiKey = key;
  if (model) p.defaultModel = model;
  if (baseUrl) p.baseUrl = baseUrl;
}

// Upsert a KEY=value line in an .env file's text (pure — testable without touching disk).
export function upsertEnvLine(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  return (content && !content.endsWith('\n') ? content + '\n' : content) + line + '\n';
}

// Persist an env var to the global ~/.orbit/.env AND set it live for this process.
export function setGlobalEnv(key, value) {
  const f = globalEnvFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const content = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  fs.writeFileSync(f, upsertEnvLine(content, key, value), 'utf8');
  process.env[key] = value;
}

// Remove an env var from the global ~/.orbit/.env and unset it live.
export function removeGlobalEnv(key) {
  const f = globalEnvFile();
  if (fs.existsSync(f)) {
    const kept = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => !l.startsWith(key + '=')).join('\n');
    fs.writeFileSync(f, kept, 'utf8');
  }
  delete process.env[key];
}

// Disconnect a provider: clear its live config so it stops being "configured" this session.
export function clearProviderConfig(name) {
  const p = config.providers[name];
  if (!p) return;
  p.apiKey = '';
  if (name === 'custom') p.baseUrl = '';
}

export function isProviderDisabled(name) {
  return config.disabled.includes(name);
}

// Turn a provider off (or back on) and persist the choice to ~/.orbit/.env. Works for keyless
// providers (claude-code, ollama) that can't be disconnected by removing a key.
export function setProviderDisabled(name, disabled) {
  const set = new Set(config.disabled);
  if (disabled) set.add(name); else set.delete(name);
  config.disabled = [...set];
  if (config.disabled.length) setGlobalEnv('ORBIT_DISABLED_PROVIDERS', config.disabled.join(','));
  else removeGlobalEnv('ORBIT_DISABLED_PROVIDERS');
}
