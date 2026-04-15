import type {
  AgentRunResponse,
  ApiResponse,
  ChatStreamEvent,
  ChatSessionView,
  Datasource,
  LlmSettingsView,
  ModelCatalogItem,
  Session
} from "@text2sql/shared-types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";

export class DatasourceApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = "DatasourceApiError";
    this.code = options?.code;
    this.details = options?.details;
  }
}

function toDatasourceApiError(error: unknown): DatasourceApiError {
  if (error instanceof DatasourceApiError) {
    return error;
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
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${url}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-user-role": role,
        "x-user-id": userId,
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
    throw new Error(
      `${payload.error.message}${
        payload.error.code ? ` [${payload.error.code}]` : ""
      }`
    );
  }
  return payload.data;
}

export async function createSession(datasource: string): Promise<Session> {
  return request<Session>("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      datasource
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
}): Promise<Datasource[]> {
  const includeUnavailable = options?.includeUnavailable ?? true;
  const query = includeUnavailable ? "" : "?includeUnavailable=false";
  return request<Datasource[]>(`/api/v1/datasources${query}`);
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
}): Promise<Datasource> {
  try {
    return await request<Datasource>("/api/v1/datasources", {
      method: "POST",
      body: JSON.stringify(input)
    });
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
  const body = new FormData();
  body.set("file", input.file);
  if (input.name?.trim()) {
    body.set("name", input.name.trim());
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/datasources/upload`, {
      method: "POST",
      headers: {
        "x-user-role": role,
        "x-user-id": userId
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
      details: payload.error.details
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
  message: string
): Promise<AgentRunResponse> {
  return request<AgentRunResponse>(
    `/api/v1/sessions/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ message })
    }
  );
}

export async function sendMessageStream(
  sessionId: string,
  message: string,
  handlers?: {
    onEvent?: (event: ChatStreamEvent) => void;
    abortSignal?: AbortSignal;
  }
): Promise<void> {
  for await (const event of streamMessageEvents(
    sessionId,
    message,
    handlers?.abortSignal
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
  abortSignal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, void> {
  const role = process.env.NEXT_PUBLIC_USER_ROLE === "user" ? "user" : "admin";
  const userId = process.env.NEXT_PUBLIC_USER_ID ?? "frontend-admin";
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/messages/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-role": role,
      "x-user-id": userId
    },
    signal: abortSignal,
    body: JSON.stringify({
      message
    })
  });
  if (!response.ok) {
    throw new Error(`流式请求失败（HTTP ${response.status}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("流式响应体不可读。");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        continue;
      }
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      if (!eventLine || dataLines.length === 0) {
        continue;
      }
      const eventType = eventLine.replace(/^event:\s*/, "");
      const payload = dataLines
        .map((line) => line.replace(/^data:\s*/, ""))
        .join("\n");
      const event = JSON.parse(payload) as ChatStreamEvent;
      yield event;
      if (eventType === "error") {
        return;
      }
    }
  }
}

export async function getMessages(sessionId: string): Promise<ChatSessionView> {
  return request<ChatSessionView>(`/api/v1/sessions/${sessionId}/messages`);
}

export async function getRun(runId: string): Promise<AgentRunResponse["run"]> {
  return request<AgentRunResponse["run"]>(`/api/v1/runs/${runId}`);
}

export async function getSettingsModelsView(): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/v1/settings/models");
}

export async function listEnabledModels(): Promise<ModelCatalogItem[]> {
  const view = await getSettingsModelsView();
  return view.models.filter((item) => item.enabled);
}
