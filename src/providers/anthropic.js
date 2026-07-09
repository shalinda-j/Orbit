import { config, maxTokens } from '../config.js';
import { postJSON } from './http.js';

export class AnthropicProvider {
  constructor() {
    this.apiKey = config.providers.anthropic.apiKey;
    this.defaultModel = config.providers.anthropic.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7, signal }) {
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
      // Cache the system prompt: it's the stable, re-sent-every-turn prefix, so a cache_control
      // breakpoint lets Anthropic serve it from cache (~90% cheaper input) on subsequent turns.
      body.system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
    }

    const data = await postJSON(url, {
      name: 'Anthropic',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body,
      signal,
    });

    const block = data.content && data.content.find(b => b.type === 'text');
    if (!block) {
      // stop_reason like 'max_tokens' with no text, or a refusal — surface, don't crash.
      if (data.stop_reason) return { content: `[no text returned: ${data.stop_reason}]`, usage: usageOf(data) };
      throw new Error(`Unexpected Anthropic response format: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { content: block.text, usage: usageOf(data) };
  }
}

// Anthropic reports fresh + cached input separately; sum them for a true prompt-token count.
function usageOf(data) {
  const u = data.usage || {};
  const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const output = u.output_tokens || 0;
  return { promptTokens: input, completionTokens: output, totalTokens: input + output };
}
