import type {
  ClarificationPrompt,
  ContextEnvelope,
  DatasourceType,
  ExecutionTrace
} from "@text2sql/shared-types";
import type { SqlTableAccessContext } from "../../../platform/data/query/index";

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
  contextEnvelope?: ContextEnvelope;
  planningScaffoldEnabled?: boolean;
  traceContext?: GraphTraceContext;
  accessContext?: SqlTableAccessContext;
}

export interface GraphEffectiveContextSummary {
  sourcePriority: "user_explicit_over_system";
  userEnvelope: {
    metricDefinitionProvided: boolean;
    timeRangeProvided: boolean;
    entityMappingCount: number;
    includeTableCount: number;
    excludeTableCount: number;
    businessConstraintCount: number;
  };
  retrievalContext?: {
    status?: "ready" | "degraded";
    selectedContextCount?: number;
  };
}

export interface GraphContextConflictHint {
  hasConflict: boolean;
  preferredSource: "user_explicit";
  reasonCodes?: string[];
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
