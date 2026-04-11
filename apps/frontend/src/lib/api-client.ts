import type {
  AgentRunResponse,
  ApiResponse,
  ChatStreamEvent,
  ChatSessionView,
  LlmSettingsView,
  ModelCatalogItem,
  Session
} from "@text2sql/shared-types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";

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

export async function createSession(): Promise<Session> {
  return request<Session>("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      datasource: "sqlite_main"
    })
  });
}

export async function listSessions(
  status?: "healthy" | "pending" | "degraded"
): Promise<Session[]> {
  const query = status ? `?status=${status}` : "";
  return request<Session[]>(`/api/v1/sessions${query}`);
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
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (!eventLine || !dataLine) {
        continue;
      }
      const eventType = eventLine.replace(/^event:\s*/, "");
      const payload = dataLine.replace(/^data:\s*/, "");
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

export async function getSettingsModelsView(): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/v1/settings/models");
}

export async function listEnabledModels(): Promise<ModelCatalogItem[]> {
  const view = await getSettingsModelsView();
  return view.models.filter((item) => item.enabled);
}
