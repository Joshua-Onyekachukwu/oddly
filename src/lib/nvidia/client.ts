/**
 * NVIDIA NIM API Client with Key Rotation
 * Uses free API keys from build.nvidia.com
 */

interface NVIDIAConfig {
  keys: string[];
  baseUrl: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletion {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ModelEndpoint {
  model: string;
  taskId: string;
}

// Model endpoints mapping
const MODEL_ENDPOINTS: Record<string, ModelEndpoint> = {
  analyst: { model: "meta/llama-3.1-70b-instruct", taskId: "chat" },
  explainer: { model: "mistralai/mistral-7b-instruct-v0.3", taskId: "chat" },
  classifier: { model: "microsoft/phi-3-mini-4k-instruct", taskId: "chat" },
  riskNarrator: { model: "google/gemma-2-9b-it", taskId: "chat" },
  sqlGenerator: { model: "meta/codellama-34b", taskId: "chat" },
  fastTagger: { model: "meta/llama-3.2-3b-instruct", taskId: "chat" },
  fallback: { model: "meta/llama-3.1-8b-instruct", taskId: "chat" },
};

// Task to model mapping
const TASK_MODEL_MAP: Record<string, string> = {
  chat: "analyst",
  explain: "explainer",
  classify_risk: "classifier",
  risk_narrative: "riskNarrator",
  generate_query: "sqlGenerator",
  tag_market: "fastTagger",
  deep_analysis: "analyst",
};

class NVIDIAClient {
  private keys: string[];
  private baseUrl: string;
  private currentKeyIndex: number = 0;
  private keyUsage: Map<string, number> = new Map();

  constructor(config: NVIDIAConfig) {
    this.keys = config.keys.filter((key) => key && key.length > 0);
    this.baseUrl = config.baseUrl;
  }

  /**
   * Get the next available API key (round-robin rotation)
   */
  private getNextKey(): string {
    if (this.keys.length === 0) {
      throw new Error("No NVIDIA API keys available");
    }

    const key = this.keys[this.currentKeyIndex];
    this.currentKeyIndex =
      (this.currentKeyIndex + 1) % this.keys.length;

    // Track usage
    const usage = this.keyUsage.get(key) || 0;
    this.keyUsage.set(key, usage + 1);

    return key;
  }

  /**
   * Create a chat completion
   */
  async chat(
    messages: ChatMessage[],
    options: {
      model?: string;
      taskId?: string;
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<ChatCompletion> {
    const { taskId = "chat", temperature = 0.7, maxTokens = 1024 } = options;

    // Resolve model from task
    const modelKey = options.model || TASK_MODEL_MAP[taskId] || "analyst";
    const endpoint = MODEL_ENDPOINTS[modelKey] || MODEL_ENDPOINTS.fallback;

    const apiKey = this.getNextKey();

    try {
      const response = await fetch(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: endpoint.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          `NVIDIA API error: ${response.status} - ${JSON.stringify(error)}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error("NVIDIA API call failed:", error);
      throw error;
    }
  }

  /**
   * Stream a chat completion
   */
  async *chatStream(
    messages: ChatMessage[],
    options: {
      model?: string;
      taskId?: string;
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): AsyncGenerator<string, void, unknown> {
    const { taskId = "chat", temperature = 0.7, maxTokens = 1024 } = options;

    const modelKey = options.model || TASK_MODEL_MAP[taskId] || "analyst";
    const endpoint = MODEL_ENDPOINTS[modelKey] || MODEL_ENDPOINTS.fallback;

    const apiKey = this.getNextKey();

    try {
      const response = await fetch(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: endpoint.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: true,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          `NVIDIA API error: ${response.status} - ${JSON.stringify(error)}`
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) yield content;
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }
    } catch (error) {
      console.error("NVIDIA streaming failed:", error);
      throw error;
    }
  }

  /**
   * Get usage statistics
   */
  getUsage(): Record<string, number> {
    return Object.fromEntries(this.keyUsage);
  }

  /**
   * Get number of active keys
   */
  getActiveKeysCount(): number {
    return this.keys.length;
  }
}

// Singleton instance
let clientInstance: NVIDIAClient | null = null;

/**
 * Get or create the NVIDIA client singleton
 */
export function getNVIDIAClient(): NVIDIAClient {
  if (!clientInstance) {
    const keys = [
      process.env.NVIDIA_KEY_1,
      process.env.NVIDIA_KEY_2,
      process.env.NVIDIA_KEY_3,
      process.env.NVIDIA_KEY_4,
      process.env.NVIDIA_KEY_5,
      process.env.NVIDIA_KEY_6,
      process.env.NVIDIA_KEY_7,
      process.env.NVIDIA_KEY_8,
      process.env.NVIDIA_KEY_9,
      process.env.NVIDIA_KEY_10,
    ].filter(Boolean) as string[];

    clientInstance = new NVIDIAClient({
      keys,
      baseUrl: "https://integrate.api.nvidia.com/v1",
    });
  }

  return clientInstance;
}

export type { ChatMessage, ChatCompletion, ModelEndpoint };
