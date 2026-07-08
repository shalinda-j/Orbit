import { config, maxTokens } from '../config.js';

export class OllamaProvider {
  constructor() {
    this.baseUrl = config.providers.ollama.baseUrl;
    this.defaultModel = config.providers.ollama.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7 }) {
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

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      
      if (data.message && data.message.content) {
        return {
          content: data.message.content,
          usage: {
            promptTokens: data.prompt_eval_count || 0,
            completionTokens: data.eval_count || 0,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
          }
        };
      } else {
        throw new Error(`Unexpected Ollama response format: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      throw new Error(`Failed to call Ollama provider at ${this.baseUrl}: ${error.message}. Is Ollama running?`);
    }
  }
}
