import { maxTokens } from '../config.js';
import { postJSON } from './http.js';

/**
 * One provider class for every OpenAI-compatible endpoint (OpenRouter, z.ai, Kimi,
 * Groq, DeepSeek, Together, Mistral, xAI, Fireworks, and any manually-added provider).
 * Constructed with an explicit config so it works for presets AND user-defined providers.
 */
export class OpenAICompatibleProvider {
  constructor({ name, baseUrl, apiKey, defaultModel }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7, signal }) {
    const selectedModel = (model && model !== 'default') ? model : this.defaultModel;
    if (!this.baseUrl) throw new Error(`${this.name}: no base URL configured`);
    if (!this.apiKey) throw new Error(`${this.name}: API key not set — add it to .env`);
    if (!selectedModel) throw new Error(`${this.name}: no model set (set the *_MODEL env or pass one)`);

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const formatted = [];
    if (systemPrompt) formatted.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formatted.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const data = await postJSON(url, {
      name: this.name,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: { model: selectedModel, messages: formatted, temperature, max_tokens: maxTokens() },
      signal,
    });
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error(`${this.name}: unexpected response ${JSON.stringify(data).slice(0, 200)}`);
    // content is null on tool-only / content-filtered replies — coerce so callers can't crash on .includes.
    const finish = data.choices[0].finish_reason;
    return {
      content: msg.content ?? (finish === 'content_filter' ? '[content filtered by provider]' : ''),
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };
  }
}
