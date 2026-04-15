export type ChatRole = "user" | "assistant" | "system";
export type RunStatus = "clarification" | "executionResult" | "rejected" | "failed";
export type SessionSyncStatus = "healthy" | "pending" | "degraded";
export type StreamStatus = "in_progress" | "completed" | "failed";
export type DatasourceType = "sqlite" | "mysql" | "postgresql" | "excel" | "csv";
export type DatasourceStatus = "available" | "unavailable" | "deleted";
export type ReasoningStage =
  | "analysis"
  | "generation"
  | "validation"
  | "execution"
  | "response"
  | "unknown";
export type LlmProviderCode =
  | "openai"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "volcengine"
  | "siliconflow"
  | "openrouter"
  | "minimax"
  | "tencent-hunyuan"
  | "tongyi";
export type ProviderSyncStatus = "idle" | "syncing" | "healthy" | "degraded" | "failed";
export type ModelHealthStatus = "unknown" | "healthy" | "degraded" | "failed";

export interface Session {
  id: string;
  datasource: string;
  datasourceName?: string;
  datasourceType?: DatasourceType;
  datasourceStatus?: DatasourceStatus;
  createdAt: string;
  title?: string;
  modelCatalogId?: string | null;
  modelProvider?: string | null;
  modelName?: string | null;
  debugEnabled?: boolean;
  lastMessageAt?: string;
  syncStatus?: SessionSyncStatus;
  deletedAt?: string | null;
  syncFailedCount?: number;
  lastSyncFailureAt?: string | null;
}

export interface Datasource {
  id: string;
  name: string;
  type: DatasourceType;
  status: DatasourceStatus;
  readonly: boolean;
  shared: boolean;
  config?: Record<string, unknown> | null;
  fileMeta?: Record<string, unknown> | null;
  unavailableAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ClarificationPrompt {
  question: string;
  reason: string;
}

export interface ExecutionTraceStep {
  node: string;
  status: "success" | "failed" | "skipped";
  stepId?: string;
  sequence?: number;
  lifecycle?: "running" | "completed" | "failed" | "skipped";
  detail?: string;
  at: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  errorSummary?: string;
}

export interface ExecutionTrace {
  runId: string;
  provider: string;
  retryCount: number;
  steps: ExecutionTraceStep[];
  streamStatus?: StreamStatus;
  toolCalls?: Array<{
    toolName: string;
    toolCallId: string;
    status: "called" | "result" | "error";
    detail?: string;
    at: string;
  }>;
}

export interface LlmRawOutput {
  provider: string;
  model: string;
  rawText: string;
  createdAt: string;
}

export interface SqlRun {
  runId: string;
  sessionId: string;
  question: string;
  status: RunStatus;
  provider: string;
  model?: string;
  sql?: string;
  explanation?: string;
  answer?: string;
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  error?: string;
  clarification?: ClarificationPrompt;
  trace: ExecutionTrace;
  llmRaw?: LlmRawOutput | null;
  createdAt: string;
}

export interface ChatSessionView {
  session: Session;
  messages: ChatMessage[];
  latestRun?: SqlRun;
}

export interface AgentRunResponse {
  kind: "agent-run";
  outcome: RunStatus;
  run: SqlRun;
  agent: {
    provider: string;
    model?: string;
    hasSql: boolean;
    hasToolCalls: boolean;
    hasError: boolean;
  };
}

export type ChatStreamEventType =
  | "start"
  | "text-delta"
  | "tool-call"
  | "tool-result"
  | "tool-error"
  | "state"
  | "finish"
  | "error";

export type ChatStreamEventData =
  | {
      requestId: string | null;
    }
  | {
      text: string;
    }
  | {
      toolName: string;
      toolCallId: string;
      input?: unknown;
    }
  | {
      toolName: string;
      toolCallId: string;
      output?: unknown;
    }
  | {
      toolName: string;
      toolCallId: string;
      message: string;
    }
  | {
      node: string;
      status: "success" | "failed" | "skipped";
      stepId?: string;
      sequence?: number;
      lifecycle?: "running" | "completed" | "failed" | "skipped";
      detail: string;
      stage?: ReasoningStage;
      title?: string;
      at?: string;
      startedAt?: string;
      endedAt?: string;
      durationMs?: number;
      inputSummary?: string;
      outputSummary?: string;
      errorSummary?: string;
    }
  | {
      status: RunStatus;
      rowCount: number;
    }
  | {
      code?: string;
      message: string;
      details?: Record<string, unknown> | null;
    };

export interface ChatStreamEvent {
  type: ChatStreamEventType;
  runId: string;
  sessionId: string;
  at: string;
  data: ChatStreamEventData;
}

export interface ProviderConfig {
  id: string;
  provider: LlmProviderCode;
  displayName: string;
  baseUrl?: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked?: string | null;
  lastSyncAt?: string | null;
  lastSyncStatus: ProviderSyncStatus;
  lastSyncError?: string | null;
  modelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModelCatalogItem {
  id: string;
  providerConfigId: string;
  provider: LlmProviderCode;
  model: string;
  displayName: string;
  capabilities?: string[];
  contextWindow?: number | null;
  enabled: boolean;
  healthStatus: ModelHealthStatus;
  lastHealthCheckAt?: string | null;
  lastSyncedAt?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsActor {
  id: string;
  role: "admin" | "user";
}

export interface LlmSettingsView {
  actor: SettingsActor;
  providers: ProviderConfig[];
  models: ModelCatalogItem[];
  defaultModelId?: string | null;
}

export type PlatformUserStatus = "active" | "disabled" | "deleted";
export type WorkspaceStatus = "active" | "archived" | "deleted";
export type WorkspaceMemberRole = "admin" | "member";

export interface PlatformUser {
  id: string;
  account: string;
  name: string;
  email: string;
  status: PlatformUserStatus;
  isSystemAdmin: boolean;
  defaultWorkspaceId?: string | null;
  systemVariables?: Record<string, unknown> | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  status: WorkspaceStatus;
  isDefault: boolean;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceMemberRole;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationRequest {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListPlatformUsersRequest extends PaginationRequest {
  keyword?: string;
  statuses?: PlatformUserStatus[];
  workspaceId?: string;
  includeDeleted?: boolean;
}

export type ListPlatformUsersResponse = PaginatedResponse<PlatformUser>;

export interface ListWorkspacesRequest extends PaginationRequest {
  keyword?: string;
  statuses?: WorkspaceStatus[];
  includeDeleted?: boolean;
}

export type ListWorkspacesResponse = PaginatedResponse<Workspace>;

export interface ListWorkspaceMembersRequest extends PaginationRequest {
  workspaceId: string;
  keyword?: string;
  roles?: WorkspaceMemberRole[];
}

export type ListWorkspaceMembersResponse = PaginatedResponse<WorkspaceMember>;

export interface EvaluationCase {
  id: string;
  question: string;
  mustIncludeSql?: string[];
  expectedStatus?: RunStatus;
}

export interface EvaluationCaseResult {
  id: string;
  passed: boolean;
  reason?: string;
  run: SqlRun;
}

export interface EvaluationReport {
  jobId: string;
  provider: string;
  total: number;
  passed: number;
  passRate: number;
  createdAt: string;
  cases: EvaluationCaseResult[];
}

export interface ApiSuccess<T> {
  status: "success";
  requestId: string;
  data: T;
}

export interface ApiFailure {
  status: "error";
  requestId: string;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
