import type { ClarificationPrompt, ExecutionTrace } from "@text2sql/shared-types";

export interface GraphInput {
  runId: string;
  sessionId: string;
  question: string;
}

export interface GraphState extends GraphInput {
  provider: string;
  sql?: string;
  explanation?: string;
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  answer?: string;
  error?: string;
  clarification?: ClarificationPrompt;
  trace: ExecutionTrace;
}

