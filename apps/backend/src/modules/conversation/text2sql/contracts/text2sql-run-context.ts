import type { ContextEnvelope } from "@text2sql/shared-types";

export interface Text2SqlRunContext {
  runId: string;
  sessionId: string;
  datasourceId: string;
  question: string;
  requestId?: string;
  contextEnvelope?: ContextEnvelope;
  metadata?: Record<string, unknown>;
}
