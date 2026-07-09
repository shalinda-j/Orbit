import { config, maxTokens } from '../config.js';
import { postJSON } from './http.js';

/**
 * Generic OpenAI-compatible provider.
 * Connect ANY endpoint that speaks the /chat/completions API:
 * OpenRouter, Groq, Together, Fireworks, DeepInfra, vLLM, LM Studio, llama.cpp, etc.
 * Configured entirely from .env (CUSTOM_BASE_URL / CUSTOM_API_KEY / CUSTOM_DEFAULT_MODEL).
 */
export class CustomProvider {
  constructor() {
    this.apiKey = config.providers.custom.apiKey;
    this.baseUrl = config.providers.custom.baseUrl;
    this.defaultModel = config.providers.custom.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7, signal }) {
    // 'default' is the sentinel the team generator emits — resolve it to the configured model.
    const selectedModel = (model && model !== 'default') ? model : this.defaultModel;

    if (!this.baseUrl) {
      throw new Error('CUSTOM_BASE_URL is not configured. Set it in .env to connect an OpenAI-compatible provider.');
    }
    if (!selectedModel) {
      throw new Error('CUSTOM_DEFAULT_MODEL is not configured. Set it in .env (or pass a model in the agent config).');
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    messages.forEach(msg => {
      formattedMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    });

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`; // local endpoints often need no key

    const data = await postJSON(url, {
      name: 'custom',
      headers,
      body: { model: selectedModel, messages: formattedMessages, temperature, max_tokens: maxTokens() },
      signal,
    });
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error(`Unexpected response format from custom provider: ${JSON.stringify(data).slice(0, 200)}`);
    const finish = data.choices[0].finish_reason;
    return {
      content: msg.content ?? (finish === 'content_filter' ? '[content filtered by provider]' : ''),
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      }
    };
  }
}
