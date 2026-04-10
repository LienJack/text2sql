import type { RunTree } from "langsmith";

export type LangsmithTraceSource = "chat" | "evaluation";

export interface LangsmithRouteContext {
  source: LangsmithTraceSource;
  route: string;
  requestId?: string;
  jobId?: string;
  caseId?: string;
}

export interface LangsmithRootContext extends LangsmithRouteContext {
  runId: string;
  sessionId: string;
  question: string;
}

export interface LangsmithRootHandle {
  runId: string;
  source: LangsmithTraceSource;
  root?: RunTree;
  queue: Promise<void>;
}

export interface LangsmithSpanPayload {
  node: string;
  status: "success" | "failed" | "skipped";
  detail?: string;
  runType?: "chain" | "llm" | "tool";
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface LangsmithRootResult {
  status: string;
  provider?: string;
  outputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface LangsmithTracingStatus {
  tracingRequested: boolean;
  configured: boolean;
  ready: boolean;
  project: string;
  endpoint: string;
}
