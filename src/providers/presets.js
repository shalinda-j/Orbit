// Built-in presets for popular OpenAI-compatible providers.
// Each is connectable by just setting <KEY_ENV> in .env — the base URL is baked in.
// Override the endpoint with the matching *_BASE_URL, and the model with *_MODEL.
// Model defaults are sensible starting points; set *_MODEL to pick another.
export const PRESETS = {
  openrouter: { label: 'OpenRouter',      baseUrl: 'https://openrouter.ai/api/v1',        keyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'openai/gpt-4o-mini' },
  zai:        { label: 'z.ai (GLM)',       baseUrl: 'https://api.z.ai/api/paas/v4',        keyEnv: 'ZAI_API_KEY',        modelEnv: 'ZAI_MODEL',        defaultModel: 'glm-4.6' },
  kimi:       { label: 'Kimi (Moonshot)',  baseUrl: 'https://api.moonshot.ai/v1',          keyEnv: 'KIMI_API_KEY',       modelEnv: 'KIMI_MODEL',       defaultModel: 'kimi-k2-0905-preview' },
  groq:       { label: 'Groq',             baseUrl: 'https://api.groq.com/openai/v1',      keyEnv: 'GROQ_API_KEY',       modelEnv: 'GROQ_MODEL',       defaultModel: 'llama-3.3-70b-versatile' },
  deepseek:   { label: 'DeepSeek',         baseUrl: 'https://api.deepseek.com/v1',         keyEnv: 'DEEPSEEK_API_KEY',   modelEnv: 'DEEPSEEK_MODEL',   defaultModel: 'deepseek-chat' },
  together:   { label: 'Together',         baseUrl: 'https://api.together.xyz/v1',         keyEnv: 'TOGETHER_API_KEY',   modelEnv: 'TOGETHER_MODEL',   defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  mistral:    { label: 'Mistral',          baseUrl: 'https://api.mistral.ai/v1',           keyEnv: 'MISTRAL_API_KEY',    modelEnv: 'MISTRAL_MODEL',    defaultModel: 'mistral-large-latest' },
  xai:        { label: 'xAI (Grok)',       baseUrl: 'https://api.x.ai/v1',                 keyEnv: 'XAI_API_KEY',        modelEnv: 'XAI_MODEL',        defaultModel: 'grok-2-latest' },
  fireworks:  { label: 'Fireworks',        baseUrl: 'https://api.fireworks.ai/inference/v1', keyEnv: 'FIREWORKS_API_KEY', modelEnv: 'FIREWORKS_MODEL',  defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
};

// The *_BASE_URL override env name for a preset (e.g. OPENROUTER_API_KEY → OPENROUTER_BASE_URL).
export const baseUrlEnv = (keyEnv) => keyEnv.replace('_API_KEY', '_BASE_URL');
