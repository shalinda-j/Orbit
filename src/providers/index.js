import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { NvidiaProvider } from './nvidia.js';
import { CustomProvider } from './custom.js';
import { ClaudeCodeProvider } from './claude-code.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { PRESETS } from './presets.js';
import { config } from '../config.js';

const instances = {
  gemini: new GeminiProvider(),
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  ollama: new OllamaProvider(),
  nvidia: new NvidiaProvider(),
  custom: new CustomProvider(),
  'claude-code': new ClaudeCodeProvider(),
};

// One generic instance per OpenAI-compatible preset (OpenRouter, z.ai, Kimi, Groq, ...).
for (const name of Object.keys(PRESETS)) {
  const c = config.providers[name];
  instances[name] = new OpenAICompatibleProvider({ name, baseUrl: c.baseUrl, apiKey: c.apiKey, defaultModel: c.defaultModel });
}

// Providers added at runtime by config/plugins (see src/extensions.js).
const extraProviders = {};
export function registerProvider(name, instance) { extraProviders[name.toLowerCase()] = instance; }

export function getProvider(name) {
  const key = name?.toLowerCase();
  const provider = instances[key] || extraProviders[key];
  if (!provider) {
    throw new Error(`Unsupported provider: "${name}". Supported: ${[...Object.keys(instances), ...Object.keys(extraProviders)].join(', ')}`);
  }
  return provider;
}

export function getSupportedProviders() {
  return [...Object.keys(instances), ...Object.keys(extraProviders)];
}
