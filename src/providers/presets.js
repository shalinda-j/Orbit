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

  // ── Chinese model providers (all OpenAI-compatible) ──
  qwen:       { label: 'Qwen (Alibaba)',   baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyEnv: 'DASHSCOPE_API_KEY', modelEnv: 'QWEN_MODEL', defaultModel: 'qwen-plus' },
  zhipu:      { label: 'Zhipu GLM (CN)',   baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyEnv: 'ZHIPU_API_KEY',     modelEnv: 'ZHIPU_MODEL',     defaultModel: 'glm-4-plus' },
  moonshot:   { label: 'Moonshot (CN)',    baseUrl: 'https://api.moonshot.cn/v1',          keyEnv: 'MOONSHOT_API_KEY',   modelEnv: 'MOONSHOT_MODEL',   defaultModel: 'moonshot-v1-8k' },
  minimax:    { label: 'MiniMax',          baseUrl: 'https://api.minimaxi.com/v1',         keyEnv: 'MINIMAX_API_KEY',    modelEnv: 'MINIMAX_MODEL',    defaultModel: 'MiniMax-Text-01' },
  yi:         { label: '01.AI (Yi)',       baseUrl: 'https://api.lingyiwanwu.com/v1',      keyEnv: 'YI_API_KEY',         modelEnv: 'YI_MODEL',         defaultModel: 'yi-large' },
  baichuan:   { label: 'Baichuan',         baseUrl: 'https://api.baichuan-ai.com/v1',      keyEnv: 'BAICHUAN_API_KEY',   modelEnv: 'BAICHUAN_MODEL',   defaultModel: 'Baichuan4-Turbo' },
  hunyuan:    { label: 'Tencent Hunyuan',  baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', keyEnv: 'HUNYUAN_API_KEY', modelEnv: 'HUNYUAN_MODEL',  defaultModel: 'hunyuan-turbo' },
  doubao:     { label: 'Doubao (Volcengine)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', keyEnv: 'ARK_API_KEY',  modelEnv: 'DOUBAO_MODEL',    defaultModel: 'doubao-pro-32k' },
  stepfun:    { label: 'StepFun',          baseUrl: 'https://api.stepfun.com/v1',          keyEnv: 'STEPFUN_API_KEY',    modelEnv: 'STEPFUN_MODEL',    defaultModel: 'step-2-16k' },
  sensenova:  { label: 'SenseNova',        baseUrl: 'https://api.sensenova.cn/compatible-mode/v1', keyEnv: 'SENSENOVA_API_KEY', modelEnv: 'SENSENOVA_MODEL', defaultModel: 'SenseChat-5' },
  spark:      { label: 'iFlytek Spark',    baseUrl: 'https://spark-api-open.xf-yun.com/v1', keyEnv: 'SPARK_API_KEY',     modelEnv: 'SPARK_MODEL',      defaultModel: '4.0Ultra' },
  siliconflow:{ label: 'SiliconFlow (CN aggregator)', baseUrl: 'https://api.siliconflow.cn/v1', keyEnv: 'SILICONFLOW_API_KEY', modelEnv: 'SILICONFLOW_MODEL', defaultModel: 'Qwen/Qwen2.5-72B-Instruct' },
};

// The *_BASE_URL override env name for a preset (e.g. OPENROUTER_API_KEY → OPENROUTER_BASE_URL).
export const baseUrlEnv = (keyEnv) => keyEnv.replace('_API_KEY', '_BASE_URL');
