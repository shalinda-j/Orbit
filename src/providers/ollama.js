import { config, maxTokens } from '../config.js';
import { postJSON } from './http.js';

export class OllamaProvider {
  constructor() {
    this.baseUrl = config.providers.ollama.baseUrl;
    this.defaultModel = config.providers.ollama.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7, signal }) {
    // 'default' is the sentinel the team generator emits — resolve it to the configured model.
    const selectedModel = (model && model !== 'default') ? model : this.defaultModel;
    const url = `${this.baseUrl}/api/chat`;

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

    const body = {
      model: selectedModel,
      messages: formattedMessages,
      stream: false,
      options: {
        temperature: temperature,
        num_predict: maxTokens(),
      }
    };

    let data;
    try {
      // Local models can be slow to load — allow a generous timeout.
      data = await postJSON(url, {
        name: 'Ollama',
        headers: { 'Content-Type': 'application/json' },
        body,
        timeoutMs: 300000,
        signal,
      });
    } catch (error) {
      throw new Error(`${error.message}. Is Ollama running at ${this.baseUrl}?`);
    }

    if (data.message && data.message.content) {
      return {
        content: data.message.content,
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        }
      };
    }
    throw new Error(`Unexpected Ollama response format: ${JSON.stringify(data).slice(0, 200)}`);
  }
}
