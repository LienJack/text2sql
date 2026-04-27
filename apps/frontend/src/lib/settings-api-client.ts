import type {
  ApiResponse,
  LlmProviderCode,
  LlmSettingsView,
  ModelCatalogItem,
  ProviderConfig,
  RagTaskConfig,
  RagTaskSettingsView,
  RagTaskType,
  RagMemoryFeedbackRequest,
  RagMemoryFeedbackResponse,
  RagQualityGateReport,
  RagReplayCompletenessReport
} from "@text2sql/shared-types";

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

type SupportedProvider = {
  provider: LlmProviderCode;
  displayName: string;
  defaultBaseUrl: string;
  supportsModelListing: boolean;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
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

function normalizeRagQualityLatest(
  value: unknown
): RagQualityGateReport["latest"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const metricsRaw = isRecord(value.metrics) ? value.metrics : {};
  const runId = readString(value.runId) ?? readString(value.run_id);
  const datasourceId =
    readString(value.datasourceId) ?? readString(value.datasource_id);
  const recordedAt = readString(value.recordedAt) ?? readString(value.recorded_at);

  if (!runId || !datasourceId || !recordedAt) {
    return undefined;
  }

  return {
    runId,
    datasourceId,
    recordedAt,
    metrics: {
      recallAt20:
        readNumber(metricsRaw.recallAt20) ?? readNumber(metricsRaw.recall_at_20) ?? 0,
      mrrAt10:
        readNumber(metricsRaw.mrrAt10) ?? readNumber(metricsRaw.mrr_at_10) ?? 0,
      retrievalRerankP95Ms:
        readNumber(metricsRaw.retrievalRerankP95Ms) ??
        readNumber(metricsRaw.retrieval_rerank_p95_ms) ??
        0,
      degradeRate:
        readNumber(metricsRaw.degradeRate) ?? readNumber(metricsRaw.degrade_rate) ?? 0
    }
  };
}

function normalizeRagQualityReport(
  report: RagQualityGateReport
): RagQualityGateReport {
  const reportRecord = report as unknown as JsonRecord;
  const latest =
    normalizeRagQualityLatest(reportRecord.latest) ??
    normalizeRagQualityLatest(reportRecord.latest_run);
  if (!latest) {
    return report;
  }

  return {
    ...report,
    latest
  };
}

export function resolveRagQualityLatestRunId(
  report: RagQualityGateReport | null | undefined
): string | undefined {
  if (!report) {
    return undefined;
  }

  const direct = report.latest?.runId?.trim();
  if (direct) {
    return direct;
  }

  const reportRecord = report as unknown as JsonRecord;
  const latestRecord = isRecord(reportRecord.latest)
    ? reportRecord.latest
    : isRecord(reportRecord.latest_run)
      ? reportRecord.latest_run
      : undefined;
  if (!latestRecord) {
    return undefined;
  }
  return readString(latestRecord.run_id);
}

export interface RagFoundationActiveIndexItem {
  datasourceId: string;
  indexVersionId: string;
  sourceVersion?: string;
  activatedAt: string;
}

export interface RagFoundationSnapshot {
  observedBuilds: number;
  buildSuccessCount: number;
  buildFailureCount: number;
  buildSuccessRate: number;
  degradedReason?: string;
  generatedAt?: string;
  failureReasons: Record<string, number>;
  activeIndexSummary: {
    total: number;
    items: RagFoundationActiveIndexItem[];
  };
}

export interface BackendHealthSnapshot {
  status: string;
  dependencies?: {
    ragIngestionMetrics?: {
      foundation?: {
        observedBuilds?: number;
        buildSuccessRate?: number;
        buildSuccessCount?: number;
        buildFailureCount?: number;
        degradedReason?: string;
        generatedAt?: string;
        failureReasons?: Record<string, number>;
        activeIndexSummary?: {
          total?: number;
          items?: Array<{
            datasourceId: string;
            indexVersionId: string;
            sourceVersion?: string;
            activatedAt: string;
          }>;
        };
      };
    };
  };
}

export function extractRagFoundationSnapshot(
  health: BackendHealthSnapshot | null | undefined
): RagFoundationSnapshot | null {
  const foundation = health?.dependencies?.ragIngestionMetrics?.foundation;
  if (!foundation) {
    return null;
  }

  return {
    observedBuilds: foundation.observedBuilds ?? 0,
    buildSuccessCount: foundation.buildSuccessCount ?? 0,
    buildFailureCount: foundation.buildFailureCount ?? 0,
    buildSuccessRate: foundation.buildSuccessRate ?? 0,
    degradedReason: foundation.degradedReason,
    generatedAt: foundation.generatedAt,
    failureReasons: foundation.failureReasons ?? {},
    activeIndexSummary: {
      total: foundation.activeIndexSummary?.total ?? 0,
      items: (foundation.activeIndexSummary?.items ?? []).map((item) => ({
        datasourceId: item.datasourceId,
        indexVersionId: item.indexVersionId,
        sourceVersion: item.sourceVersion,
        activatedAt: item.activatedAt
      }))
    }
  };
}

export type ProviderPayload = {
  provider: LlmProviderCode;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
};

export type RagTaskConfigPayload = {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  dimensions?: number;
  vectorVersion?: string;
  timeoutMs?: number;
  note?: string;
};

export type RagTaskConfigHealthPayload = {
  sampleQuery?: string;
  sampleCandidates?: string[];
};

export type RagTaskConfigHealthResult = {
  taskType: RagTaskType;
  status: "healthy" | "degraded" | "failed";
  reasonCode: string;
  message: string;
  checkedAt: string;
  latencyMs: number;
  configSource: "settings" | "env_fallback" | "missing";
  config?: RagTaskConfig;
  details?: Record<string, unknown>;
  challenge?: {
    status: "comparable" | "sample_not_ready" | "evidence_missing" | "not_comparable";
    baselineTopScore?: number;
    candidateTopScore?: number;
    delta?: number;
    topCandidateId?: string;
    reasonCode: string;
  };
  sample?: {
    reranked: Array<{
      rank: number;
      score: number;
      reason: string;
    }>;
  };
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const role = process.env.NEXT_PUBLIC_USER_ROLE === "user" ? "user" : "admin";
  const userId = process.env.NEXT_PUBLIC_USER_ID ?? "frontend-admin";
  const response = await fetch(composeApiUrl(url), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-user-role": role,
      "x-user-id": userId,
      ...(init?.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Settings API returned non-JSON response (${response.status} ${response.statusText}, content-type: ${contentType})`
    );
  }
  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.status === "error") {
    throw new Error(
      `${payload.error.message}${
        payload.error.code ? ` [${payload.error.code}]` : ""
      }`
    );
  }
  return payload.data;
}

export async function fetchSettingsView(): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/v1/settings/models");
}

export async function fetchSupportedProviders(): Promise<SupportedProvider[]> {
  return request<SupportedProvider[]>("/api/v1/settings/providers/supported");
}

export async function fetchRagTaskConfigs(): Promise<RagTaskSettingsView> {
  return request<RagTaskSettingsView>("/api/v1/settings/rag-configs");
}

export async function upsertRagTaskConfig(
  taskType: RagTaskType,
  payload: RagTaskConfigPayload
): Promise<RagTaskConfig> {
  return request<RagTaskConfig>(
    `/api/v1/settings/rag-configs/${encodeURIComponent(taskType)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export async function checkRagTaskConfigHealth(
  taskType: RagTaskType,
  payload?: RagTaskConfigHealthPayload
): Promise<RagTaskConfigHealthResult> {
  return request<RagTaskConfigHealthResult>(
    `/api/v1/settings/rag-configs/${encodeURIComponent(taskType)}/health`,
    {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    }
  );
}

export async function createProviderConfig(
  payload: ProviderPayload
): Promise<ProviderConfig> {
  return request<ProviderConfig>("/api/v1/settings/providers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateProviderConfig(
  providerConfigId: string,
  payload: ProviderPayload
): Promise<ProviderConfig> {
  return request<ProviderConfig>(`/api/v1/settings/providers/${providerConfigId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteProviderConfig(
  providerConfigId: string
): Promise<{ deleted: boolean; providerConfigId: string }> {
  return request<{ deleted: boolean; providerConfigId: string }>(
    `/api/v1/settings/providers/${providerConfigId}`,
    {
      method: "DELETE"
    }
  );
}

export async function syncProviderModels(providerConfigId: string): Promise<{
  provider: ProviderConfig;
  syncedModels: ModelCatalogItem[];
}> {
  return request<{
    provider: ProviderConfig;
    syncedModels: ModelCatalogItem[];
  }>(`/api/v1/settings/providers/${providerConfigId}/sync`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function checkProviderHealth(providerConfigId: string): Promise<{
  provider: ProviderConfig;
  status: string;
  message: string;
  checkedAt: string;
  latencyMs: number;
}> {
  return request<{
    provider: ProviderConfig;
    status: string;
    message: string;
    checkedAt: string;
    latencyMs: number;
  }>(`/api/v1/settings/providers/${providerConfigId}/health`, {
    method: "POST"
  });
}

export async function setModelEnabled(
  modelId: string,
  enabled: boolean
): Promise<ModelCatalogItem> {
  return request<ModelCatalogItem>(
    `/api/v1/settings/models/${encodeURIComponent(modelId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ enabled })
    }
  );
}

export async function batchSetModelsEnabled(
  modelIds: string[],
  enabled: boolean
): Promise<{ updated: number }> {
  return request<{ updated: number }>("/api/v1/settings/models/batch", {
    method: "PATCH",
    body: JSON.stringify({ modelIds, enabled })
  });
}

export async function fetchModelStatuses(): Promise<
  Array<{ id: string; enabled: boolean }>
> {
  return request<Array<{ id: string; enabled: boolean }>>(
    "/api/v1/settings/models/status"
  );
}

export async function fetchBackendHealthSnapshot(): Promise<BackendHealthSnapshot> {
  return request<BackendHealthSnapshot>("/api/health");
}

export async function fetchRagQualityReport(): Promise<RagQualityGateReport> {
  const report = await request<RagQualityGateReport>("/api/v1/rag/quality/report");
  return normalizeRagQualityReport(report);
}

export async function fetchRagReplayCompleteness(
  runId: string
): Promise<RagReplayCompletenessReport> {
  return request<RagReplayCompletenessReport>(
    `/api/v1/rag/quality/replay/${encodeURIComponent(runId)}`
  );
}

export async function submitRagMemoryFeedback(
  payload: RagMemoryFeedbackRequest
): Promise<RagMemoryFeedbackResponse> {
  return request<RagMemoryFeedbackResponse>("/api/v1/rag/memory/feedback", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
