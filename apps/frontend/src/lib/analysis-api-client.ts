import type {
  AnalysisEvent,
  AnalysisGoalContract,
  AnalysisTaskReadModel,
  AnalysisTaskRecord,
  AnalysisTaskStatus,
  ApiResponse
} from "@text2sql/shared-types";

const API_BASE_OVERRIDE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const API_BASE = API_BASE_OVERRIDE ? API_BASE_OVERRIDE.replace(/\/+$/, "") : "";
const TERMINAL_STATUSES = new Set<AnalysisTaskStatus>([
  "completed",
  "partial",
  "cancelled",
  "failed"
]);

export type AnalysisConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed";

export type AnalysisTaskUiState = {
  readModel: AnalysisTaskReadModel | null;
  events: AnalysisEvent[];
  connection: AnalysisConnectionState;
  error: string;
};

export type AnalysisTaskUiAction =
  | { type: "hydrate"; readModel: AnalysisTaskReadModel }
  | { type: "merge_events"; events: AnalysisEvent[] }
  | { type: "connection"; connection: AnalysisConnectionState }
  | { type: "error"; error: string }
  | { type: "reset" };

export const initialAnalysisTaskUiState: AnalysisTaskUiState = {
  readModel: null,
  events: [],
  connection: "idle",
  error: ""
};

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

export function resolveAnalysisWorkspaceId(): string {
  if (typeof window !== "undefined") {
    const stored = window.sessionStorage
      .getItem("text2sql.activeWorkspaceId")
      ?.trim();
    if (stored) {
      return stored;
    }
    const queried = new URLSearchParams(window.location.search)
      .get("workspaceId")
      ?.trim();
    if (queried) {
      return queried;
    }
  }
  return process.env.NEXT_PUBLIC_WORKSPACE_ID?.trim() ?? "";
}

function authHeaders(workspaceId?: string): HeadersInit {
  const resolvedWorkspaceId = workspaceId?.trim() || resolveAnalysisWorkspaceId();
  return {
    "Content-Type": "application/json",
    "x-user-role": process.env.NEXT_PUBLIC_DEV_USER_ROLE?.trim() || "admin",
    "x-user-id": process.env.NEXT_PUBLIC_DEV_USER_ID?.trim() || "analysis-ui",
    ...(resolvedWorkspaceId ? { "x-workspace-id": resolvedWorkspaceId } : {})
  };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  workspaceId?: string
): Promise<T> {
  const response = await fetch(composeApiUrl(path), {
    ...init,
    headers: { ...authHeaders(workspaceId), ...init.headers }
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || payload.status === "error") {
    const message =
      payload.status === "error"
        ? `${payload.error.message} (${payload.error.code})`
        : `Analysis API 请求失败 (${response.status})`;
    throw new Error(message);
  }
  return payload.data;
}

export function isAnalysisTerminal(status: AnalysisTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function eventKey(event: AnalysisEvent): string {
  return `${event.taskId}:${event.attemptId ?? "task"}:${event.sequence}`;
}

export function mergeAnalysisTaskEvents(
  current: AnalysisEvent[],
  incoming: AnalysisEvent[]
): AnalysisEvent[] {
  const merged = new Map(current.map((event) => [eventKey(event), event]));
  const sequenceOwners = new Map(
    current.map((event) => [`${event.taskId}:${event.sequence}`, event.id])
  );
  for (const event of incoming) {
    const sequenceKey = `${event.taskId}:${event.sequence}`;
    const owner = sequenceOwners.get(sequenceKey);
    if (owner && owner !== event.id) {
      throw new Error(`Analysis event sequence conflict: ${sequenceKey}`);
    }
    sequenceOwners.set(sequenceKey, event.id);
    merged.set(eventKey(event), event);
  }
  return Array.from(merged.values()).sort((left, right) => {
    if (left.taskId !== right.taskId) {
      return left.taskId.localeCompare(right.taskId);
    }
    return left.sequence - right.sequence;
  });
}

function preserveTerminalReadModel(
  current: AnalysisTaskReadModel | null,
  incoming: AnalysisTaskReadModel
): AnalysisTaskReadModel {
  if (
    current &&
    current.task.id === incoming.task.id &&
    isAnalysisTerminal(current.task.status) &&
    !isAnalysisTerminal(incoming.task.status)
  ) {
    return {
      ...incoming,
      task: {
        ...incoming.task,
        status: current.task.status,
        terminalAt: current.task.terminalAt
      }
    };
  }
  return incoming;
}

export function analysisTaskReducer(
  state: AnalysisTaskUiState,
  action: AnalysisTaskUiAction
): AnalysisTaskUiState {
  if (action.type === "reset") {
    return initialAnalysisTaskUiState;
  }
  if (action.type === "connection") {
    return { ...state, connection: action.connection };
  }
  if (action.type === "error") {
    return { ...state, error: action.error };
  }
  if (action.type === "merge_events") {
    return {
      ...state,
      events: mergeAnalysisTaskEvents(state.events, action.events)
    };
  }
  const readModel = preserveTerminalReadModel(state.readModel, action.readModel);
  return {
    ...state,
    readModel,
    events: mergeAnalysisTaskEvents(state.events, readModel.events),
    error: ""
  };
}

export async function listAnalysisTasks(
  workspaceId: string
): Promise<AnalysisTaskRecord[]> {
  return request<AnalysisTaskRecord[]>(
    `/api/v1/analysis/tasks?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`,
    {},
    workspaceId
  );
}

export async function getAnalysisTask(
  taskId: string,
  workspaceId?: string
): Promise<AnalysisTaskReadModel> {
  return request<AnalysisTaskReadModel>(
    `/api/v1/analysis/tasks/${encodeURIComponent(taskId)}`,
    {},
    workspaceId
  );
}

export async function createAnalysisTask(
  goalContract: AnalysisGoalContract
): Promise<AnalysisTaskReadModel> {
  const idempotencyKey = crypto.randomUUID();
  return request<AnalysisTaskReadModel>(
    "/api/v1/analysis/tasks",
    {
      method: "POST",
      headers: { "x-idempotency-key": idempotencyKey },
      body: JSON.stringify({ goalContract, idempotencyKey })
    },
    goalContract.workspaceId
  );
}

export async function commandAnalysisTask(input: {
  task: AnalysisTaskRecord;
  type: "start" | "pause" | "resume" | "cancel";
}): Promise<void> {
  await request(
    `/api/v1/analysis/tasks/${encodeURIComponent(input.task.id)}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        type: input.type,
        expectedTaskVersion: input.task.version,
        expectedAuthorityEpoch: input.task.authorityEpoch
      })
    },
    input.task.workspaceId
  );
}

export async function runNextAnalysisWork(
  taskId: string,
  workspaceId: string
): Promise<void> {
  await request(
    `/api/v1/analysis/tasks/${encodeURIComponent(taskId)}/work/next`,
    { method: "POST", body: "{}" },
    workspaceId
  );
}

function parseEventBlock(block: string): AnalysisEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) {
    return null;
  }
  const event = JSON.parse(data) as AnalysisEvent;
  if (
    event.protocol !== "analysis-task-protocol" ||
    event.version !== "1.0.0" ||
    !Number.isSafeInteger(event.sequence)
  ) {
    throw new Error("Analysis event protocol invalid");
  }
  return event;
}

export async function streamAnalysisTaskEvents(input: {
  taskId: string;
  workspaceId: string;
  cursor: number;
  signal: AbortSignal;
  onEvent: (event: AnalysisEvent) => void;
}): Promise<void> {
  const response = await fetch(
    composeApiUrl(
      `/api/v1/analysis/tasks/${encodeURIComponent(input.taskId)}/events/stream?cursor=${input.cursor}`
    ),
    { headers: authHeaders(input.workspaceId), signal: input.signal }
  );
  if (!response.ok || !response.body) {
    throw new Error(`Analysis event stream unavailable (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseEventBlock(block);
      if (event) {
        input.onEvent(event);
      }
      boundary = buffer.indexOf("\n\n");
    }
    if (done) {
      return;
    }
  }
}
