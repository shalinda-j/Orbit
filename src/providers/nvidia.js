import { config } from '../config.js';

export class NvidiaProvider {
  constructor() {
    this.apiKey = config.providers.nvidia.apiKey;
    this.defaultModel = config.providers.nvidia.defaultModel;
    this.baseUrl = config.providers.nvidia.baseUrl;
  }

  // Supported models from NVIDIA Build (Featured Models)
  static MODELS = {
    'nemotron': 'nvidia/nemotron-3-ultra-550b-a55b',
    'kimi': 'moonshotai/kimi-k2.6',
    'deepseek': 'deepseek-ai/deepseek-v4-pro',
    'glm': 'zhipu-ai/glm-5.1',
  };

  static getModelFullName(shortName) {
    return NvidiaProvider.MODELS[shortName?.toLowerCase()] || shortName;
  }

  async chat({ systemPrompt, messages, model, temperature = 0.7 }) {
    let selectedModel = model || this.defaultModel;

    // Allow short-hand model names (e.g., 'nemotron', 'kimi', 'deepseek', 'glm')
    if (NvidiaProvider.MODELS[selectedModel?.toLowerCase()]) {
      selectedModel = NvidiaProvider.MODELS[selectedModel.toLowerCase()];
    }

    if (!this.apiKey) {
      throw new Error("NVIDIA_API_KEY is not configured in environment variables. Get one from https://build.nvidia.com");
    }

    const url = `${this.baseUrl}/chat/completions`;

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
      temperature: temperature,
      max_tokens: 4096,
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
        throw new Error(`NVIDIA API error (${response.status}): ${errorText}`);
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
        throw new Error(`Unexpected NVIDIA response format: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      throw new Error(`Failed to call NVIDIA provider: ${error.message}`);
    }
  }
}
