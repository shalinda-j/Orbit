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

  async chat({ systemPrompt, messages, model, temperature = 0.7 }) {
    const selectedModel = (model && model !== 'default') ? model : this.defaultModel;
    if (!this.baseUrl) throw new Error(`${this.name}: no base URL configured`);
    if (!this.apiKey) throw new Error(`${this.name}: API key not set — add it to .env`);
    if (!selectedModel) throw new Error(`${this.name}: no model set (set the *_MODEL env or pass one)`);

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const formatted = [];
    if (systemPrompt) formatted.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => formatted.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: selectedModel, messages: formatted, temperature, max_tokens: 4096 }),
      });
      if (!res.ok) throw new Error(`${this.name} API error (${res.status}): ${(await res.text()).slice(0, 300)}`);

      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return {
          content: data.choices[0].message.content,
          usage: {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            totalTokens: data.usage?.total_tokens || 0,
          },
        };
      }
      throw new Error(`${this.name}: unexpected response ${JSON.stringify(data).slice(0, 200)}`);
    } catch (error) {
      throw new Error(`Failed to call ${this.name}: ${error.message}`);
    }
  }
}
