import type {
  AgentRunResponse,
  ApiResponse,
  ChatStreamEvent,
  ChatSessionView,
  ContextEnvelope,
  Datasource,
  DeliveryEvidenceLayer,
  PreviewDatasourceTablesRequest,
  PreviewDatasourceTablesResponse,
  PromptTemplateTraceEvidenceCompat,
  DatasourceUpsertPayload,
  LlmSettingsView,
  ModelCatalogItem,
  SendMessageRequest,
  Session,
  UpsertDatasourceWorkflowRequest,
  UpsertDatasourceWorkflowResponse
} from "@text2sql/shared-types";
import { readSseStream } from "@text2sql/chat-stream-protocol";

const API_BASE_OVERRIDE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const API_BASE = API_BASE_OVERRIDE ? API_BASE_OVERRIDE.replace(/\/+$/, "") : "";

function composeApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) {
    return normalizedPath;
  }
  if (
    API_BASE.endsWith("/api") &&
    (normalizedPath === "/api" || normalizedPath.startsWith("/api/"))
  ) {
    return `${API_BASE.slice(0, -4)}${normalizedPath}`;
  }
  return `${API_BASE}${normalizedPath}`;
}

function resolveWorkspaceIdHeader(): string | undefined {
  if (typeof window !== "undefined") {
    const fromStorage = window.sessionStorage
      .getItem("text2sql.activeWorkspaceId")
      ?.trim();
    if (fromStorage) {
      return fromStorage;
    }
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("workspaceId")?.trim();
    if (fromQuery) {
      return fromQuery;
    }
  }
  const fromEnv = process.env.NEXT_PUBLIC_WORKSPACE_ID?.trim();
  return fromEnv || undefined;
}

export class DatasourceApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly stage?: string;

  constructor(
    message: string,
    options?: { code?: string; details?: unknown; stage?: string }
  ) {
    super(message);
    this.name = "DatasourceApiError";
    this.code = options?.code;
    this.details = options?.details;
    this.stage = options?.stage;
  }
}

class ApiClientRequestError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly stage?: string;

  constructor(
    message: string,
    options?: { code?: string; details?: unknown; stage?: string }
  ) {
    super(message);
    this.name = "ApiClientRequestError";
    this.code = options?.code;
    this.details = options?.details;
    this.stage = options?.stage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

type DeliveryDisplayType = "table" | "metric" | "bar" | "line" | "pie";
type DeliveryArtifactCompat = NonNullable<
  NonNullable<AgentRunResponse["run"]["delivery"]>["artifact"]
> &
  Record<string, unknown>;

const DISPLAY_TYPE_ALLOWLIST: ReadonlySet<DeliveryDisplayType> = new Set([
  "table",
  "metric",
  "bar",
  "line",
  "pie"
]);
const CHART_TYPE_ALLOWLIST: ReadonlySet<Exclude<DeliveryDisplayType, "table">> = new Set([
  "metric",
  "bar",
  "line",
  "pie"
]);

function normalizeDisplayType(value: unknown): DeliveryDisplayType | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return DISPLAY_TYPE_ALLOWLIST.has(normalized as DeliveryDisplayType)
    ? (normalized as DeliveryDisplayType)
    : undefined;
}

function normalizeChartMappings(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const normalized = Object.entries(value).reduce<Record<string, string>>(
    (acc, [key, mapping]) => {
      const next = readString(mapping);
      if (next) {
        acc[key] = next;
      }
      return acc;
    },
    {}
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeDeliveryArtifactCompatibility(
  value: unknown
): DeliveryArtifactCompat | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalizedRecord: Record<string, unknown> = {
    ...(value as Record<string, unknown>)
  };

  if (
    normalizedRecord.summary !== undefined &&
    typeof normalizedRecord.summary !== "string" &&
    !isRecord(normalizedRecord.summary)
  ) {
    delete normalizedRecord.summary;
  }
  if (normalizedRecord.table !== undefined && !isRecord(normalizedRecord.table)) {
    delete normalizedRecord.table;
  }
  if (
    normalizedRecord.display !== undefined &&
    typeof normalizedRecord.display !== "string" &&
    !isRecord(normalizedRecord.display)
  ) {
    delete normalizedRecord.display;
  }
  if (
    normalizedRecord.validation !== undefined &&
    typeof normalizedRecord.validation !== "string" &&
    !isRecord(normalizedRecord.validation)
  ) {
    delete normalizedRecord.validation;
  }
  if (
    normalizedRecord.fallback !== undefined &&
    typeof normalizedRecord.fallback !== "string" &&
    !isRecord(normalizedRecord.fallback)
  ) {
    delete normalizedRecord.fallback;
  }
  if (normalizedRecord.visualIntent !== undefined && !isRecord(normalizedRecord.visualIntent)) {
    delete normalizedRecord.visualIntent;
  }

  const chart = isRecord(normalizedRecord.chart) ? normalizedRecord.chart : undefined;
  const chartType = chart
    ? normalizeDisplayType(chart.type ?? chart.chartType ?? chart.chart_type)
    : undefined;
  const chartMappings = chart
    ? normalizeChartMappings(chart.mappings ?? chart.mapping ?? chart.fields)
    : undefined;
  const chartInvalidReason = chart
    ? !chartType || !CHART_TYPE_ALLOWLIST.has(chartType as Exclude<DeliveryDisplayType, "table">)
      ? "invalid_chart_type"
      : !chartMappings
        ? "missing_chart_mappings"
        : undefined
    : undefined;

  if (chartInvalidReason) {
    delete normalizedRecord.chart;

    const displayRecord: Record<string, unknown> =
      typeof normalizedRecord.display === "string"
        ? { type: normalizeDisplayType(normalizedRecord.display) ?? "table" }
        : isRecord(normalizedRecord.display)
          ? { ...normalizedRecord.display }
          : {};
    displayRecord.type = "table";
    normalizedRecord.display = displayRecord;

    const fallbackRecord: Record<string, unknown> =
      typeof normalizedRecord.fallback === "string"
        ? { reason: normalizedRecord.fallback }
        : isRecord(normalizedRecord.fallback)
          ? { ...normalizedRecord.fallback }
          : {};
    if (!readString(fallbackRecord.reason)) {
      fallbackRecord.reason = chartInvalidReason;
    }
    const fallbackTarget = normalizeDisplayType(
      fallbackRecord.target ?? fallbackRecord.displayType ?? fallbackRecord.to
    );
    if (!fallbackTarget) {
      fallbackRecord.target = "table";
    }
    normalizedRecord.fallback = fallbackRecord;
  } else if (chart && chartType && chartMappings) {
    normalizedRecord.chart = {
      ...chart,
      type: chartType,
      mappings: chartMappings
    };
  }

  const hasErrorRaw =
    readBoolean(normalizedRecord.hasError) ?? readBoolean(normalizedRecord.has_error);
  if (hasErrorRaw !== undefined) {
    normalizedRecord.hasError = hasErrorRaw;
  }

  const rowCountRaw =
    readNumber(normalizedRecord.rowCount) ?? readNumber(normalizedRecord.row_count);
  if (rowCountRaw !== undefined) {
    normalizedRecord.rowCount = Math.max(0, Math.floor(rowCountRaw));
  }

  if (
    typeof normalizedRecord.rowCount !== "number" ||
    typeof normalizedRecord.hasError !== "boolean"
  ) {
    return undefined;
  }

  return normalizedRecord as unknown as DeliveryArtifactCompat;
}

function normalizeSkillContextSummary(
  value: unknown
): DeliveryEvidenceLayer["skillContextSummary"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const skills = Array.isArray(value.skills) ? value.skills.length : undefined;
  const contexts = Array.isArray(value.context) ? value.context.length : undefined;
  const skillCount = readNumber(value.skillCount) ?? readNumber(value.skill_count) ?? skills;
  const contextCount =
    readNumber(value.contextCount) ?? readNumber(value.context_count) ?? contexts;
  const degradeReason = readString(value.degradeReason) ?? readString(value.degrade_reason);

  if (skillCount === undefined && contextCount === undefined && !degradeReason) {
    return undefined;
  }

  return {
    skillCount: Math.max(0, Math.floor(skillCount ?? 0)),
    contextCount: Math.max(0, Math.floor(contextCount ?? 0)),
    ...(degradeReason ? { degradeReason } : {})
  };
}

function normalizeRunSemanticEvidenceCompatibility(
  run: AgentRunResponse["run"]
): AgentRunResponse["run"] {
  const rawTrace = run.trace as AgentRunResponse["run"]["trace"] & Record<string, unknown>;
  const tracePromptTemplate = normalizePromptTemplateTraceEvidenceCompatibility(
    rawTrace.promptTemplate ??
      rawTrace.prompt_template ??
      rawTrace.prompt_template_evidence ??
      rawTrace.templateEvidence
  );
  const delivery = run.delivery;
  const rawEvidence = delivery?.evidence as
    | (DeliveryEvidenceLayer & Record<string, unknown>)
    | undefined;
  const semanticVersionRaw =
    readNumber(rawEvidence?.semanticVersion) ?? readNumber(rawEvidence?.semantic_version);
  const semanticVersion =
    semanticVersionRaw !== undefined && semanticVersionRaw > 0
      ? Math.floor(semanticVersionRaw)
      : undefined;
  const semanticLockStatusRaw =
    readString(rawEvidence?.semanticLockStatus) ??
    readString(rawEvidence?.semantic_lock_status);
  const semanticLockStatus: DeliveryEvidenceLayer["semanticLockStatus"] =
    semanticLockStatusRaw === "locked" ||
    semanticLockStatusRaw === "fallback" ||
    semanticLockStatusRaw === "degraded"
      ? semanticLockStatusRaw
      : undefined;
  const semanticDegradeReason =
    readString(rawEvidence?.semanticDegradeReason) ??
    readString(rawEvidence?.semantic_degrade_reason);
  const skillContextSummary = normalizeSkillContextSummary(
    rawEvidence?.skillContextSummary ??
      rawEvidence?.skill_context_summary ??
      rawEvidence?.skill_context
  );
  const evidencePromptTemplate = normalizePromptTemplateTraceEvidenceCompatibility(
    rawEvidence?.promptTemplate ??
      rawEvidence?.prompt_template ??
      rawEvidence?.prompt_template_evidence ??
      rawEvidence?.templateEvidence
  );
  const resolvedPromptTemplate = evidencePromptTemplate ?? tracePromptTemplate;
  const nextTrace = resolvedPromptTemplate
    ? {
        ...run.trace,
        promptTemplate: resolvedPromptTemplate
      }
    : run.trace;
  const normalizedArtifact = normalizeDeliveryArtifactCompatibility(delivery?.artifact);

  if (!delivery) {
    return nextTrace === run.trace ? run : { ...run, trace: nextTrace };
  }

  const nextEvidence: DeliveryEvidenceLayer | undefined =
    delivery.evidence || resolvedPromptTemplate
      ? {
          runId: delivery.evidence?.runId ?? run.runId,
          ...delivery.evidence,
          ...(semanticVersion !== undefined ? { semanticVersion } : {}),
          ...(semanticLockStatus ? { semanticLockStatus } : {}),
          ...(semanticDegradeReason ? { semanticDegradeReason } : {}),
          ...(skillContextSummary ? { skillContextSummary } : {}),
          ...(resolvedPromptTemplate ? { promptTemplate: resolvedPromptTemplate } : {})
        }
      : delivery.evidence;

  return {
    ...run,
    trace: nextTrace,
    delivery: {
      ...delivery,
      ...(nextEvidence ? { evidence: nextEvidence } : {}),
      ...(normalizedArtifact ? { artifact: normalizedArtifact } : {})
    }
  };
}

function normalizePromptTemplateTraceEvidenceCompatibility(
  value: unknown
): DeliveryEvidenceLayer["promptTemplate"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = value as PromptTemplateTraceEvidenceCompat & Record<string, unknown>;
  const templateId = readString(candidate.templateId ?? candidate.template_id);
  const scope = normalizePromptTemplateScope(
    candidate.scope ??
      candidate.scope_type ??
      candidate.template_scope ??
      candidate.scopeType
  );
  const version = readPositiveInteger(
    candidate.version ?? candidate.template_version ?? candidate.templateVersion
  );
  const fallbackReason = readString(
    candidate.fallbackReason ??
      candidate.fallback_reason ??
      candidate.fallback_reason_code
  );
  const scene = normalizePromptTemplateScene(
    candidate.scene ?? candidate.scene_name ?? candidate.template_scene
  );

  if (!templateId && !scope && version === undefined && !fallbackReason && !scene) {
    return undefined;
  }

  return {
    ...(templateId ? { templateId } : {}),
    ...(scene ? { scene } : {}),
    ...(scope ? { scope } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(fallbackReason ? { fallbackReason } : {})
  };
}

function normalizePromptTemplateScope(
  value: unknown
): "global" | "workspace" | "datasource" | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (
    normalized === "global" ||
    normalized === "workspace" ||
    normalized === "datasource"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizePromptTemplateScene(value: unknown): "sql" | "analysis" | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "sql" || normalized === "analysis") {
    return normalized;
  }
  if (normalized === "sql_generation") {
    return "sql";
  }
  return undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = readNumber(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function resolveWorkflowStage(details: unknown): string | undefined {
  if (!isRecord(details)) {
    return undefined;
  }

  const candidates = [
    details.stage,
    details.failedStage,
    details.workflowStage
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}

function normalizeIdempotencyKey(
  idempotencyKey: string | undefined
): string | undefined {
  const normalized = idempotencyKey?.trim();
  return normalized ? normalized : undefined;
}

export function createIdempotencyKey(prefix = "datasource-workflow"): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

function withIdempotencyHeader(
  idempotencyKey: string | undefined
): Record<string, string> {
  const normalized = normalizeIdempotencyKey(idempotencyKey);
  return normalized ? { "x-idempotency-key": normalized } : {};
}

export interface DatasourceWorkflowApiErrorPayload {
  stage?: string;
  code?: string;
  details?: unknown;
}

export function resolveDatasourceWorkflowApiError(
  error: unknown
): DatasourceWorkflowApiErrorPayload {
  if (error instanceof DatasourceApiError) {
    return {
      stage: error.stage,
      code: error.code,
      details: error.details
    };
  }

  if (error instanceof ApiClientRequestError) {
    return {
      stage: error.stage,
      code: error.code,
      details: error.details
    };
  }

  return {};
}

function toDatasourceApiError(error: unknown): DatasourceApiError {
  if (error instanceof DatasourceApiError) {
    return error;
  }

  if (error instanceof ApiClientRequestError) {
    return new DatasourceApiError(error.message, {
      code: error.code,
      details: error.details,
      stage: error.stage
    });
  }

  if (error instanceof Error) {
    const codeMatch = error.message.match(/\[([A-Z0-9_]+)\]\s*$/);
    const code = codeMatch?.[1];
    const message = code
      ? error.message.replace(/\s*\[[A-Z0-9_]+\]\s*$/, "")
      : error.message;
    return new DatasourceApiError(message, { code });
  }

  return new DatasourceApiError(String(error));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const role = process.env.NEXT_PUBLIC_USER_ROLE === "user" ? "user" : "admin";
  const userId = process.env.NEXT_PUBLIC_USER_ID ?? "frontend-admin";
  const workspaceId = resolveWorkspaceIdHeader();
  let response: Response;
  try {
    response = await fetch(composeApiUrl(url), {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-user-role": role,
        "x-user-id": userId,
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        ...(init?.headers ?? {})
      }
    });
  } catch (error) {
    throw new Error(
      `网络请求失败，请检查后端地址与跨域配置。(${error instanceof Error ? error.message : String(error)})`
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    throw new Error(
      `后端返回了非 JSON 响应（HTTP ${response.status}）。${body.slice(0, 200)}`
    );
  }

  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.status === "error") {
    throw new ApiClientRequestError(payload.error.message, {
      code: payload.error.code,
      details: payload.error.details,
      stage: resolveWorkflowStage(payload.error.details)
    });
  }
  return payload.data;
}

export async function createSession(
  datasource: string,
  options?: { workspaceId?: string }
): Promise<Session> {
  const workspaceId = options?.workspaceId?.trim() || resolveWorkspaceIdHeader();
  return request<Session>("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      datasource,
      ...(workspaceId ? { workspaceId } : {})
    })
  });
}

export async function listSessions(
  options?: {
    status?: "healthy" | "pending" | "degraded";
    datasource?: string;
    view?: "current" | "readonly-history" | "all";
  }
): Promise<Session[]> {
  const params = new URLSearchParams();
  if (options?.status) {
    params.set("status", options.status);
  }
  if (options?.datasource) {
    params.set("datasource", options.datasource);
  }
  if (options?.view) {
    params.set("view", options.view);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<Session[]>(`/api/v1/sessions${query}`);
}

export async function listDatasources(options?: {
  includeUnavailable?: boolean;
  ignoreWorkspaceScope?: boolean;
}): Promise<Datasource[]> {
  const includeUnavailable = options?.includeUnavailable ?? true;
  const query = includeUnavailable ? "" : "?includeUnavailable=false";
  const headers = options?.ignoreWorkspaceScope
    ? {
        "x-workspace-id": ""
      }
    : undefined;
  return request<Datasource[]>(`/api/v1/datasources${query}`, {
    headers
  });
}

export async function createDatasource(input: {
  name: string;
  type: "sqlite" | "mysql" | "postgresql";
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  filePath?: string;
  shared?: boolean;
}, options?: { idempotencyKey?: string }): Promise<Datasource> {
  try {
    return await request<Datasource>("/api/v1/datasources", {
      method: "POST",
      headers: withIdempotencyHeader(options?.idempotencyKey),
      body: JSON.stringify(input)
    });
  } catch (error) {
    throw toDatasourceApiError(error);
  }
}

export async function updateDatasource(
  datasourceId: string,
  input: DatasourceUpsertPayload,
  options?: { idempotencyKey?: string }
): Promise<Datasource> {
  try {
    return await request<Datasource>(`/api/v1/datasources/${datasourceId}`, {
      method: "PATCH",
      headers: withIdempotencyHeader(options?.idempotencyKey),
      body: JSON.stringify(input)
    });
  } catch (error) {
    throw toDatasourceApiError(error);
  }
}

export async function submitDatasourceWorkflow(
  input: UpsertDatasourceWorkflowRequest,
  options?: { idempotencyKey?: string }
): Promise<UpsertDatasourceWorkflowResponse> {
  try {
    return await request<UpsertDatasourceWorkflowResponse>(
      "/api/v1/datasources/workflow",
      {
        method: "POST",
        headers: withIdempotencyHeader(options?.idempotencyKey),
        body: JSON.stringify(input)
      }
    );
  } catch (error) {
    throw toDatasourceApiError(error);
  }
}

export async function previewDatasourceTables(
  input: PreviewDatasourceTablesRequest,
  options?: { idempotencyKey?: string }
): Promise<PreviewDatasourceTablesResponse> {
  try {
    return await request<PreviewDatasourceTablesResponse>(
      "/api/v1/datasources/table-preview",
      {
        method: "POST",
        headers: withIdempotencyHeader(options?.idempotencyKey),
        body: JSON.stringify(input)
      }
    );
  } catch (error) {
    throw toDatasourceApiError(error);
  }
}

export async function uploadDatasourceFile(input: {
  file: File;
  name?: string;
}): Promise<Datasource> {
  const role = process.env.NEXT_PUBLIC_USER_ROLE === "user" ? "user" : "admin";
  const userId = process.env.NEXT_PUBLIC_USER_ID ?? "frontend-admin";
  const workspaceId = resolveWorkspaceIdHeader();
  const body = new FormData();
  body.set("file", input.file);
  if (input.name?.trim()) {
    body.set("name", input.name.trim());
  }

  let response: Response;
  try {
    response = await fetch(composeApiUrl("/api/v1/datasources/upload"), {
      method: "POST",
      headers: {
        "x-user-role": role,
        "x-user-id": userId,
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {})
      },
      body
    });
  } catch (error) {
    throw new DatasourceApiError(
      `网络请求失败，请检查后端地址与跨域配置。(${error instanceof Error ? error.message : String(error)})`
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const payload = await response.text();
    throw new DatasourceApiError(
      `后端返回了非 JSON 响应（HTTP ${response.status}）。${payload.slice(0, 200)}`
    );
  }

  const payload = (await response.json()) as ApiResponse<Datasource>;
  if (payload.status === "error") {
    throw new DatasourceApiError(payload.error.message, {
      code: payload.error.code,
      details: payload.error.details,
      stage: resolveWorkflowStage(payload.error.details)
    });
  }
  return payload.data;
}

export async function renameSession(
  sessionId: string,
  title: string
): Promise<Session> {
  return request<Session>(`/api/v1/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

export async function setSessionDebugEnabled(
  sessionId: string,
  debugEnabled: boolean
): Promise<Session> {
  return request<Session>(`/api/v1/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ debugEnabled })
  });
}

export async function setSessionModel(
  sessionId: string,
  modelCatalogId: string
): Promise<Session> {
  return request<Session>(`/api/v1/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ modelCatalogId })
  });
}

export async function probeModelConnectivity(modelCatalogId: string): Promise<{
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
}> {
  return request<{
    ok: boolean;
    provider: string;
    model: string;
    latencyMs: number;
  }>(`/api/v1/models/${modelCatalogId}/probe`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function deleteSession(
  sessionId: string
): Promise<{ deleted: boolean; sessionId: string }> {
  return request<{ deleted: boolean; sessionId: string }>(
    `/api/v1/sessions/${sessionId}`,
    {
      method: "DELETE"
    }
  );
}

export async function sendMessage(
  sessionId: string,
  message: string,
  contextEnvelope?: ContextEnvelope
): Promise<AgentRunResponse> {
  const payload: SendMessageRequest = {
    message,
    ...(contextEnvelope ? { contextEnvelope } : {})
  };
  const response = await request<AgentRunResponse>(
    `/api/v1/sessions/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
  const normalizedRun = normalizeRunSemanticEvidenceCompatibility(response.run);
  return {
    ...response,
    run: normalizedRun,
    ...(normalizedRun.delivery ? { delivery: normalizedRun.delivery } : {})
  };
}

export async function sendMessageStream(
  sessionId: string,
  message: string,
  handlers?: {
    onEvent?: (event: ChatStreamEvent) => void;
    abortSignal?: AbortSignal;
    contextEnvelope?: ContextEnvelope;
  }
): Promise<void> {
  for await (const event of streamMessageEvents(
    sessionId,
    message,
    handlers?.abortSignal,
    handlers?.contextEnvelope
  )) {
    handlers?.onEvent?.(event);
    if (event.type === "error") {
      const messageText =
        (event.data as { message?: string } | undefined)?.message ?? "流式响应失败";
      throw new Error(messageText);
    }
  }
}

export async function* streamMessageEvents(
  sessionId: string,
  message: string,
  abortSignal?: AbortSignal,
  contextEnvelope?: ContextEnvelope
): AsyncGenerator<ChatStreamEvent, void, void> {
  const role = process.env.NEXT_PUBLIC_USER_ROLE === "user" ? "user" : "admin";
  const userId = process.env.NEXT_PUBLIC_USER_ID ?? "frontend-admin";
  const workspaceId = resolveWorkspaceIdHeader();
  const response = await fetch(
    composeApiUrl(`/api/v1/sessions/${sessionId}/messages/stream`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-role": role,
        "x-user-id": userId,
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {})
      },
      signal: abortSignal,
      body: JSON.stringify({
        message,
        ...(contextEnvelope ? { contextEnvelope } : {})
      } satisfies SendMessageRequest)
    }
  );
  if (!response.ok) {
    throw new Error(`流式请求失败（HTTP ${response.status}）`);
  }
  for await (const event of readSseStream(response.body)) {
    yield event;
  }
}

export async function getMessages(sessionId: string): Promise<ChatSessionView> {
  return request<ChatSessionView>(`/api/v1/sessions/${sessionId}/messages`);
}

export async function getRun(runId: string): Promise<AgentRunResponse["run"]> {
  const run = await request<AgentRunResponse["run"]>(`/api/v1/runs/${runId}`);
  return normalizeRunSemanticEvidenceCompatibility(run);
}

export async function getSettingsModelsView(): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/v1/settings/models");
}

export async function listEnabledModels(): Promise<ModelCatalogItem[]> {
  const view = await getSettingsModelsView();
  return view.models.filter((item) => item.enabled);
}
