const ACTIVE_DATASOURCE_KEY = "text2sql.activeDatasourceId";
const ACTIVE_WORKSPACE_KEY = "text2sql.activeWorkspaceId";

export interface ChatRouteContext {
  datasourceId: string;
  sessionId: string;
  workspaceId: string;
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

export function readActiveWorkspaceId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return normalizeContextValue(
    window.sessionStorage.getItem(ACTIVE_WORKSPACE_KEY)
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

export function writeActiveWorkspaceId(workspaceId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const value = normalizeContextValue(workspaceId);
  if (!value) {
    window.sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    return;
  }
  window.sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, value);
}

export function readChatRouteContext(search?: string): ChatRouteContext {
  if (typeof window === "undefined" && search === undefined) {
    return {
      datasourceId: "",
      sessionId: "",
      workspaceId: ""
    };
  }

  const params = new URLSearchParams(
    search ?? (typeof window === "undefined" ? "" : window.location.search)
  );
  return {
    datasourceId: normalizeContextValue(params.get("datasource")),
    sessionId: normalizeContextValue(params.get("sessionId")),
    workspaceId: normalizeContextValue(params.get("workspaceId"))
  };
}

export function replaceChatRouteContext(context: {
  datasourceId?: string;
  sessionId?: string;
  workspaceId?: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }

  const datasourceId = normalizeContextValue(context.datasourceId);
  const sessionId = normalizeContextValue(context.sessionId);
  const next = new URL(window.location.href);

  next.searchParams.delete("datasource");
  next.searchParams.delete("sessionId");
  next.searchParams.delete("workspaceId");

  if (datasourceId) {
    next.searchParams.set("datasource", datasourceId);
  }
  if (sessionId) {
    next.searchParams.set("sessionId", sessionId);
  }
  const workspaceId = normalizeContextValue(context.workspaceId);
  if (workspaceId) {
    next.searchParams.set("workspaceId", workspaceId);
  }

  const nextPath = `${next.pathname}${next.search}${next.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath !== currentPath) {
    window.history.replaceState({}, "", nextPath);
  }
}
