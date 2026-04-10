import type { ApiResponse, ChatMessage, Session, SqlRun } from "@text2sql/shared-types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.status === "error") {
    throw new Error(payload.error.message);
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

