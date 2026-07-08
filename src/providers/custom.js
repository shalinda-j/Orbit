import { config, maxTokens } from '../config.js';

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

  async chat({ systemPrompt, messages, model, temperature = 0.7 }) {
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

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: selectedModel,
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens(),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Custom API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return {
          content: data.choices[0].message.content,
          usage: {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            totalTokens: data.usage?.total_tokens || 0
          }
        };
      }
      throw new Error(`Unexpected response format from custom provider: ${JSON.stringify(data)}`);
    } catch (error) {
      throw new Error(`Failed to call custom provider at ${this.baseUrl}: ${error.message}`);
    }
  }
}
