import { config, maxTokens } from '../config.js';

export class AnthropicProvider {
  constructor() {
    this.apiKey = config.providers.anthropic.apiKey;
    this.defaultModel = config.providers.anthropic.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7 }) {
    const selectedModel = model || this.defaultModel;
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured in environment variables.");
    }

    const url = 'https://api.anthropic.com/v1/messages';

    // Map messages: Anthropic uses role 'user' and 'assistant'
    const formattedMessages = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));

    const body = {
      model: selectedModel,
      messages: formattedMessages,
      max_tokens: maxTokens(),
      temperature: temperature,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      
      if (data.content && data.content[0] && data.content[0].text) {
        return {
          content: data.content[0].text,
          usage: {
            promptTokens: data.usage?.input_tokens || 0,
            completionTokens: data.usage?.output_tokens || 0,
            totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
          }
        };
      } else {
        throw new Error(`Unexpected Anthropic response format: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      throw new Error(`Failed to call Anthropic provider: ${error.message}`);
    }
  }
}
