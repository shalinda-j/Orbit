import { config, maxTokens } from '../config.js';
import { postJSON } from './http.js';

export class GeminiProvider {
  constructor() {
    this.apiKey = config.providers.gemini.apiKey;
    this.defaultModel = config.providers.gemini.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7, signal }) {
    const selectedModel = model || this.defaultModel;
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not configured in environment variables.");
    }

    // Key goes in a header (x-goog-api-key), NOT the URL — a URL-embedded key leaks into
    // error text, proxy logs, and browser/history the way ?key= does.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`;

    // Map message roles: user -> user, assistant -> model
    const contents = messages.map(msg => {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      return {
        role: role,
        parts: [{ text: msg.content }]
      };
    });

    const body = {
      contents: contents,
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: maxTokens(),
      }
    };

    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    const data = await postJSON(url, {
      name: 'Gemini',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body,
      signal,
    });

    const usage = {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0,
    };
    const part = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0];
    if (part) return { content: part.text, usage };
    // A 200 with no candidate parts means a safety block or empty finish — surface the reason, don't crash.
    const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason;
    if (reason) return { content: `[Gemini returned no content: ${reason}]`, usage };
    throw new Error(`Unexpected Gemini response format: ${JSON.stringify(data).slice(0, 200)}`);
  }
}
