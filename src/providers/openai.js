import { config } from '../config.js';

export class OpenAIProvider {
  constructor() {
    this.apiKey = config.providers.openai.apiKey;
    this.defaultModel = config.providers.openai.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7 }) {
    const selectedModel = model || this.defaultModel;
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not configured in environment variables.");
    }

    const url = 'https://api.openai.com/v1/chat/completions';

    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    
    // Map roles standard: user -> user, assistant -> assistant
    messages.forEach(msg => {
      formattedMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    });

    const body = {
      model: selectedModel,
      messages: formattedMessages,
      temperature: temperature,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
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
      } else {
        throw new Error(`Unexpected OpenAI response format: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      throw new Error(`Failed to call OpenAI provider: ${error.message}`);
    }
  }
}
