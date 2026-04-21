import type { ClarificationPrompt, ExecutionTrace } from "@text2sql/shared-types";
import type { DatasourceType } from "@text2sql/shared-types";
import type { SqlTableAccessContext } from "../../platform/data/query/index";

export interface GraphTraceContext {
  source: "chat" | "evaluation";
  route: string;
  requestId?: string;
  jobId?: string;
  caseId?: string;
}

export interface GraphInput {
  runId: string;
  sessionId: string;
  question: string;
  datasourceId: string;
  datasourceType?: DatasourceType;
  modelCatalogId?: string;
  planningScaffoldEnabled?: boolean;
  traceContext?: GraphTraceContext;
  accessContext?: SqlTableAccessContext;
}

export interface GraphState extends GraphInput {
  provider: string;
  model?: string;
  sql?: string;
  explanation?: string;
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  answer?: string;
  error?: string;
  clarification?: ClarificationPrompt;
  trace: ExecutionTrace;
}
