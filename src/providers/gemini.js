import { config } from '../config.js';

export class GeminiProvider {
  constructor() {
    this.apiKey = config.providers.gemini.apiKey;
    this.defaultModel = config.providers.gemini.defaultModel;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7 }) {
    const selectedModel = model || this.defaultModel;
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not configured in environment variables.");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${this.apiKey}`;

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
      }
    };

    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

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
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
        return {
          content: data.candidates[0].content.parts[0].text,
          usage: {
            promptTokens: data.usageMetadata?.promptTokenCount || 0,
            completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata?.totalTokenCount || 0
          }
        };
      } else {
        throw new Error(`Unexpected Gemini response format: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      throw new Error(`Failed to call Gemini provider: ${error.message}`);
    }
  }
}
