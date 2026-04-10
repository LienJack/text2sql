import type { ApiResponse, ChatMessage, Session, SqlRun } from "@text2sql/shared-types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${url}`, {
      ...init,
      headers: {
        "content-type": "application/json",
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

export async function sendMessage(
  sessionId: string,
  message: string
): Promise<{ responseType: string; run: SqlRun }> {
  return request<{ responseType: string; run: SqlRun }>(
    `/api/v1/sessions/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ message })
    }
  );
}

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  return request<ChatMessage[]>(`/api/v1/sessions/${sessionId}/messages`);
}
