/**
 * LLM Provider Abstraction Layer
 *
 * Decouples agent orchestration from concrete inference endpoints:
 * - MockProvider: Deterministic scripted or rule-driven provider for testing.
 * - OllamaProvider: Local inference via Ollama daemon.
 * - GeminiProvider: Remote inference via Google GenAI SDK (Gemini 3.8 Flash).
 */

import { Ollama } from "ollama";
import { GoogleGenAI } from "@google/genai";

export interface LLMToolCall {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  content?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMProvider {
  readonly id: string;
  chat(
    messages: LLMMessage[],
    tools: LLMToolDeclaration[]
  ): Promise<LLMResponse>;
}

// ─── Mock Provider ────────────────────────────────────────────────────────────

export interface MockScriptStep {
  content?: string;
  tool_calls?: LLMToolCall[];
}

export class MockProvider implements LLMProvider {
  readonly id = "mock";
  private scriptQueue: MockScriptStep[] = [];
  private fallbackHeuristic: boolean = false;
  private callCount: number = 0;

  constructor(options?: {
    script?: MockScriptStep[];
    fallbackHeuristic?: boolean;
  }) {
    if (options?.script) {
      this.scriptQueue = [...options.script];
    }
    this.fallbackHeuristic = options?.fallbackHeuristic ?? false;
  }

  enqueue(step: MockScriptStep): void {
    this.scriptQueue.push(step);
  }

  get totalCalls(): number {
    return this.callCount;
  }

  async chat(
    messages: LLMMessage[],
    _tools: LLMToolDeclaration[]
  ): Promise<LLMResponse> {
    this.callCount++;

    // 1. Consume from scripted queue if available
    if (this.scriptQueue.length > 0) {
      const step = this.scriptQueue.shift()!;
      return {
        content: step.content,
        tool_calls: step.tool_calls,
      };
    }

    // 2. Autonomous heuristic fallback if enabled
    if (this.fallbackHeuristic) {
      const lastMessage = messages[messages.length - 1];

      // If last message was a tool result, formulate next action or stop
      if (lastMessage.role === "tool") {
        return {
          content: "Observation processed. I have updated my plan.",
        };
      }

      // Default first action in a turn: observe surroundings
      return {
        content: "Observing current surroundings.",
        tool_calls: [
          {
            type: "function",
            function: {
              name: "observe_surroundings",
              arguments: { radius: 50 },
            },
          },
        ],
      };
    }

    // 3. Default empty response
    return {
      content: "No action planned.",
    };
  }
}

// ─── Ollama Provider ──────────────────────────────────────────────────────────

export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";
  private client: Ollama;
  private model: string;

  constructor(model: string = "llama3.2:1b", host?: string) {
    this.client = new Ollama(host ? { host } : undefined);
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolDeclaration[]
  ): Promise<LLMResponse> {
    const ollamaTools = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const response = await this.client.chat({
      model: this.model,
      messages: messages as any,
      tools: ollamaTools as any,
    });

    const toolCalls: LLMToolCall[] | undefined = response.message.tool_calls?.map(
      (tc: any) => ({
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })
    );

    return {
      content: response.message.content,
      tool_calls: toolCalls,
    };
  }
}

// ─── Gemini Provider ──────────────────────────────────────────────────────────

export class GeminiProvider implements LLMProvider {
  readonly id = "gemini";
  private client: GoogleGenAI;
  private model: string;

  constructor(model: string = "gemini-3.8-flash", apiKey?: string) {
    this.client = new GoogleGenAI(apiKey ? { apiKey } : {});
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolDeclaration[]
  ): Promise<LLMResponse> {
    // Map function declarations to Gemini SDK structure
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    }));

    // Convert messages to Gemini contents format
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "tool") {
          return {
            role: "user",
            parts: [{ text: `[Tool Result]: ${m.content ?? ""}` }],
          };
        }
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content ?? "" }],
        };
      });

    const systemInstruction = messages.find((m) => m.role === "system")?.content;

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations }],
      },
    });

    const candidate = response.candidates?.[0];
    const toolCalls: LLMToolCall[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.functionCall) {
          toolCalls.push({
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: (part.functionCall.args as Record<string, unknown>) ?? {},
            },
          });
        }
      }
    }

    return {
      content: response.text ?? undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
