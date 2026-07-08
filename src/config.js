import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { PRESETS, baseUrlEnv } from './providers/presets.js';

// Load environment variables from .env in current working directory
dotenv.config({ quiet: true }); // ponytail: silence dotenv's tip banner — it pollutes CLI stdout that agents parse

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

// Effective output-token cap for a call. Ponytail "lazy" mode tightens it hard to slash token spend.
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
  const prov = config.providers[providerName];
  if (!prov) return false;
  if (providerName === 'ollama') return true;            // local, doesn't strictly need a key
  if (providerName === 'custom') return !!prov.baseUrl;  // key optional (local endpoints), URL required
  if (providerName === 'claude-code') return claudeCodeAvailable(); // subscription via the `claude` CLI
  return !!prov.apiKey;
}
