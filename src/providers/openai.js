import { config, maxTokens } from '../config.js';
import { postJSON } from './http.js';

export class OpenAIProvider {
  constructor() {
    this.apiKey = config.providers.openai.apiKey;
    this.defaultModel = config.providers.openai.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7, signal }) {
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
      max_tokens: maxTokens(),
    };

    const data = await postJSON(url, {
      name: 'OpenAI',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body,
      signal,
    });

    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error(`Unexpected OpenAI response format: ${JSON.stringify(data).slice(0, 200)}`);
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
