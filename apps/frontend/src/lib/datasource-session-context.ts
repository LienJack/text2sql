const ACTIVE_DATASOURCE_KEY = "text2sql.activeDatasourceId";

export interface ChatRouteContext {
  datasourceId: string;
  sessionId: string;
}

function normalizeContextValue(value?: string | null): string {
  return value?.trim() ?? "";
}

export function readActiveDatasourceId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return normalizeContextValue(
    window.sessionStorage.getItem(ACTIVE_DATASOURCE_KEY)
  );
}

export function writeActiveDatasourceId(datasourceId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const value = normalizeContextValue(datasourceId);
  if (!value) {
    window.sessionStorage.removeItem(ACTIVE_DATASOURCE_KEY);
    return;
  }
  window.sessionStorage.setItem(ACTIVE_DATASOURCE_KEY, value);
}

export function readChatRouteContext(search?: string): ChatRouteContext {
  if (typeof window === "undefined" && search === undefined) {
    return {
      datasourceId: "",
      sessionId: ""
    };
  }

  const params = new URLSearchParams(
    search ?? (typeof window === "undefined" ? "" : window.location.search)
  );
  return {
    datasourceId: normalizeContextValue(params.get("datasource")),
    sessionId: normalizeContextValue(params.get("sessionId"))
  };
}

export function replaceChatRouteContext(context: {
  datasourceId?: string;
  sessionId?: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }

  const datasourceId = normalizeContextValue(context.datasourceId);
  const sessionId = normalizeContextValue(context.sessionId);
  const next = new URL(window.location.href);

  next.searchParams.delete("datasource");
  next.searchParams.delete("sessionId");

  if (datasourceId) {
    next.searchParams.set("datasource", datasourceId);
  }
  if (sessionId) {
    next.searchParams.set("sessionId", sessionId);
  }

  const nextPath = `${next.pathname}${next.search}${next.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath !== currentPath) {
    window.history.replaceState({}, "", nextPath);
  }
}
