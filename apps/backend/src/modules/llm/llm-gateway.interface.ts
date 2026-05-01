export interface LlmGatewayPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface LlmGatewayToolDefinition {
  description: string;
  inputSchema: unknown;
  execute: (input: unknown) => Promise<unknown> | unknown;
}

export type LlmGatewayStreamEvent =
  | {
      type: "text-delta";
      text: string;
    }
  | {
      type: "tool-call";
      toolName: string;
      toolCallId: string;
      input?: unknown;
    }
  | {
      type: "tool-result";
      toolName: string;
      toolCallId: string;
      output?: unknown;
    }
  | {
      type: "tool-error";
      toolName: string;
      toolCallId: string;
      message: string;
    };

export interface LlmGatewayRuntimeConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  streamTimeoutMs?: number;
}

export interface LlmGatewayGenerateOutput {
  provider: string;
  model: string;
  rawText: string;
  prompt: LlmGatewayPrompt;
}

export interface LlmGateway {
  generate(
    prompt: LlmGatewayPrompt,
    runtime: LlmGatewayRuntimeConfig
  ): Promise<LlmGatewayGenerateOutput>;

  stream(
    prompt: LlmGatewayPrompt,
    runtime: LlmGatewayRuntimeConfig,
    options?: {
      abortSignal?: AbortSignal;
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<LlmGatewayGenerateOutput>;
}
