import type {
  ApiResponse,
  CreateGlossaryAnchorRequest,
  CreateGlossaryTermRequest,
  GlossaryAnchor,
  GlossaryAnchorType,
  GlossaryConflictDecision,
  GlossaryLinkageStatus,
  GlossaryScope,
  GlossaryTerm,
  GlossaryTermStatus,
  RollbackGlossaryAnchorRequest,
  RollbackGlossaryAnchorResponse,
  UpdateGlossaryTermRequest,
  UpsertGlossaryTermResponse
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

function resolveWorkspaceIdHeader(): string | undefined {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("workspaceId")?.trim();
    if (fromQuery) {
      return fromQuery;
    }
    const fromStorage = window.sessionStorage
      .getItem("text2sql.activeWorkspaceId")
      ?.trim();
    if (fromStorage) {
      return fromStorage;
    }
  }
  const fromEnv = process.env.NEXT_PUBLIC_WORKSPACE_ID?.trim();
  return fromEnv || undefined;
}

export type UserStatus = "active" | "disabled";
export type WorkspaceMemberRole = "admin" | "member";

export interface WorkspaceSummary {
  id: string;
  name: string;
  isDefault: boolean;
  memberCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminUser {
  id: string;
  account: string;
  name: string;
  email: string;
  status: UserStatus;
  isSystemAdmin: boolean;
  workspaces: WorkspaceSummary[];
  variables: Record<string, string>;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  account: string;
  name: string;
  email: string;
  role: WorkspaceMemberRole;
  status: UserStatus;
  createdAt: string;
}

export interface WorkspaceDatasourceBinding {
  id: string;
  workspaceId: string;
  datasourceId: string;
  datasourceName?: string;
  datasourceType?: string;
  datasourceStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDatasourceTablePermissionsSnapshot {
  workspaceId: string;
  datasourceId: string;
  tableNames: string[];
  policyVersion: number;
}

export interface ReplaceWorkspaceDatasourceTablePermissionsInput {
  tableNames: string[];
  policyVersion: number;
  idempotencyKey?: string;
}

export interface ReplaceWorkspaceDatasourceTablePermissionsResult {
  workspaceId: string;
  datasourceId: string;
  tableNames: string[];
  policyVersion: number;
  beforeCount: number;
  afterCount: number;
  addedCount: number;
  removedCount: number;
  retainedCount: number;
  addedTables: string[];
  removedTables: string[];
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserListParams {
  keyword?: string;
  status?: UserStatus | "all";
  workspaceId?: string;
  page?: number;
  pageSize?: number;
}

export interface WorkspaceListParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface UserUpsertInput {
  account: string;
  name: string;
  email: string;
  status: UserStatus;
  workspaceIds: string[];
  variables: Record<string, string>;
}

export interface GlossaryListParams {
  scope?: GlossaryScope | "all";
  datasourceId?: string;
  status?: GlossaryTermStatus | "all";
  query?: string;
  version?: number;
  page?: number;
  pageSize?: number;
}

export interface GlossaryAnchorListParams {
  scope?: GlossaryScope | "all";
  datasourceId?: string;
  anchorType?: GlossaryAnchorType | "all";
  page?: number;
  pageSize?: number;
}

export interface CreateGlossaryAnchorResult {
  anchor: GlossaryAnchor;
  previousAnchorId: string | null;
  replayed: boolean;
  idempotencyKey: string;
}

export type PromptTemplateScene = "sql" | "analysis";
export type PromptTemplateStatus = "active" | "draft";
export type PromptTemplateScopeType = "global" | "workspace" | "datasource";

export interface PromptTemplate {
  id: string;
  name: string;
  scene: PromptTemplateScene;
  scopeType: PromptTemplateScopeType;
  scopeId: string | null;
  scopeLabel: string;
  version: number;
  status: PromptTemplateStatus;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateListParams {
  scene?: PromptTemplateScene | "all";
  status?: PromptTemplateStatus | "all";
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface PromptTemplateUpsertInput {
  name: string;
  scene: PromptTemplateScene;
  scopeType: PromptTemplateScopeType;
  scopeId?: string;
  content: string;
  status: PromptTemplateStatus;
}

function toVariableList(
  variables: Record<string, string>
): Array<{ key: string; value: string }> {
  return Object.entries(variables)
    .map(([key, value]) => ({
      key: key.trim(),
      value: value.trim()
    }))
    .filter((item) => item.key.length > 0 && item.value.length > 0);
}

export class AdminApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = "AdminApiError";
    this.code = options?.code;
    this.details = options?.details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toAdminApiError(error: unknown): AdminApiError {
  if (error instanceof AdminApiError) {
    return error;
  }
  if (error instanceof Error) {
    const codeMatch = error.message.match(/\[([A-Z0-9_]+)\]\s*$/);
    const code = codeMatch?.[1];
    const message = code
      ? error.message.replace(/\s*\[[A-Z0-9_]+\]\s*$/, "")
      : error.message;
    return new AdminApiError(message, { code });
  }
  return new AdminApiError(String(error));
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeTableNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const item of value) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped).sort((left, right) => left.localeCompare(right));
}

function normalizeWorkspaceSummary(value: unknown): WorkspaceSummary {
  if (!isRecord(value)) {
    return {
      id: "",
      name: "",
      isDefault: false
    };
  }

  return {
    id: String(value.id ?? value.workspaceId ?? ""),
    name: String(value.name ?? ""),
    isDefault: Boolean(value.isDefault),
    memberCount:
      typeof value.memberCount === "number" ? value.memberCount : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined
  };
}

function normalizeUser(value: unknown): AdminUser {
  const record = isRecord(value) ? value : {};
  const status = record.status === "disabled" ? "disabled" : "active";
  const rawVariables = isRecord(record.variables)
    ? record.variables
    : isRecord(record.systemVariables)
      ? record.systemVariables
      : {};
  const rawVariableList = Array.isArray(record.variables)
    ? record.variables
    : Array.isArray(record.systemVariables)
      ? record.systemVariables
      : [];

  const variables: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawVariables)) {
    if (!key.trim()) {
      continue;
    }
    variables[key] = typeof val === "string" ? val : String(val ?? "");
  }
  for (const variable of rawVariableList) {
    if (!isRecord(variable)) {
      continue;
    }
    const key = typeof variable.key === "string" ? variable.key.trim() : "";
    if (!key) {
      continue;
    }
    variables[key] =
      typeof variable.value === "string"
        ? variable.value
        : String(variable.value ?? "");
  }

  const workspaceList = Array.isArray(record.workspaces)
    ? record.workspaces
    : Array.isArray(record.workspaceList)
      ? record.workspaceList
      : [];
  const workspaceIdList = Array.isArray(record.workspaceIds)
    ? record.workspaceIds
    : [];

  return {
    id: String(record.id ?? ""),
    account: String(record.account ?? record.username ?? ""),
    name: String(record.name ?? ""),
    email: String(record.email ?? ""),
    status,
    isSystemAdmin: Boolean(record.isSystemAdmin),
    workspaces:
      workspaceList.length > 0
        ? workspaceList
            .map((item) => normalizeWorkspaceSummary(item))
            .filter((item) => item.id)
        : workspaceIdList
            .map((workspaceId) =>
              typeof workspaceId === "string"
                ? {
                    id: workspaceId,
                    name: workspaceId,
                    isDefault: false
                  }
                : null
            )
            .filter((item): item is WorkspaceSummary => Boolean(item)),
    variables,
    createdAt: String(record.createdAt ?? new Date(0).toISOString()),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined
  };
}

function normalizeWorkspace(value: unknown): WorkspaceSummary {
  return normalizeWorkspaceSummary(value);
}

function normalizeWorkspaceMember(value: unknown): WorkspaceMember {
  const record = isRecord(value) ? value : {};
  const user = isRecord(record.user) ? record.user : undefined;
  const userId = String(record.userId ?? user?.id ?? "");
  const account = String(record.account ?? user?.account ?? userId);
  const name = String(record.name ?? user?.name ?? account);
  return {
    id: String(record.id ?? ""),
    userId,
    account,
    name,
    email: String(record.email ?? user?.email ?? ""),
    role: record.role === "admin" ? "admin" : "member",
    status: record.status === "disabled" ? "disabled" : "active",
    createdAt: String(record.createdAt ?? new Date(0).toISOString())
  };
}

function normalizeWorkspaceDatasourceBinding(
  value: unknown
): WorkspaceDatasourceBinding {
  const record = isRecord(value) ? value : {};
  return {
    id: String(record.id ?? ""),
    workspaceId: String(record.workspaceId ?? ""),
    datasourceId: String(record.datasourceId ?? ""),
    datasourceName:
      typeof record.datasourceName === "string" ? record.datasourceName : undefined,
    datasourceType:
      typeof record.datasourceType === "string" ? record.datasourceType : undefined,
    datasourceStatus:
      typeof record.datasourceStatus === "string" ? record.datasourceStatus : undefined,
    createdAt: String(record.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(record.updatedAt ?? new Date(0).toISOString())
  };
}

function normalizePromptTemplateScene(value: unknown): PromptTemplateScene {
  return value === "analysis" ? "analysis" : "sql";
}

function normalizePromptTemplateStatus(value: unknown): PromptTemplateStatus {
  if (value === "draft" || value === "archived" || value === "inactive") {
    return "draft";
  }
  return "active";
}

function normalizePromptTemplateScopeType(value: unknown): PromptTemplateScopeType {
  if (value === "workspace" || value === "datasource") {
    return value;
  }
  return "global";
}

function normalizePromptTemplate(value: unknown): PromptTemplate {
  const record = isRecord(value) ? value : {};
  const scopeType = normalizePromptTemplateScopeType(
    record.scopeType ?? record.scope
  );
  const rawScopeId =
    typeof record.scopeId === "string"
      ? record.scopeId
      : scopeType === "workspace" && typeof record.workspaceId === "string"
        ? record.workspaceId
        : scopeType === "datasource" && typeof record.datasourceId === "string"
          ? record.datasourceId
          : "";
  const scopeId = rawScopeId.trim() ? rawScopeId.trim() : null;
  const scopeLabel =
    typeof record.scopeLabel === "string" && record.scopeLabel.trim()
      ? record.scopeLabel.trim()
      : scopeType === "global"
        ? "全局"
        : (scopeId ?? (scopeType === "workspace" ? "工作空间" : "数据源"));

  return {
    id: String(record.id ?? record.templateId ?? ""),
    name: String(record.name ?? record.title ?? ""),
    scene: normalizePromptTemplateScene(record.scene),
    scopeType,
    scopeId,
    scopeLabel,
    version: Math.max(1, readNumber(record.version ?? record.templateVersion, 1)),
    status: normalizePromptTemplateStatus(record.status),
    content: String(record.content ?? record.template ?? record.prompt ?? ""),
    createdAt: String(record.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(
      record.updatedAt ?? record.modifiedAt ?? record.createdAt ?? new Date(0).toISOString()
    )
  };
}

function normalizePromptTemplateFromPayload(value: unknown): PromptTemplate {
  const record = isRecord(value) ? value : {};
  if (isRecord(record.template)) {
    return normalizePromptTemplate(record.template);
  }
  if (isRecord(record.item)) {
    return normalizePromptTemplate(record.item);
  }
  return normalizePromptTemplate(value);
}

function normalizeGlossaryScope(value: unknown): GlossaryScope {
  return value === "datasource" ? "datasource" : "global";
}

function normalizeGlossaryStatus(value: unknown): GlossaryTermStatus {
  return value === "inactive" ? "inactive" : "active";
}

function normalizeGlossaryLinkageStatus(value: unknown): GlossaryLinkageStatus {
  if (value === "degraded" || value === "empty" || value === "error") {
    return value;
  }
  return "success";
}

function normalizeGlossaryConflictDecision(
  value: unknown
): GlossaryConflictDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    resolution: "priority_then_updated_at",
    winnerTermId: String(value.winnerTermId ?? ""),
    loserTermIds: Array.isArray(value.loserTermIds)
      ? value.loserTermIds.map((item) => String(item))
      : [],
    winnerPriority: readNumber(value.winnerPriority, 0),
    winnerUpdatedAt: String(value.winnerUpdatedAt ?? new Date(0).toISOString())
  };
}

function normalizeGlossaryAnchor(value: unknown): GlossaryAnchor | null {
  if (!isRecord(value)) {
    return null;
  }
  const scope = normalizeGlossaryScope(value.scope);
  const anchorType = value.anchorType === "rollback" ? "rollback" : "release";
  const status =
    value.status === "superseded" || value.status === "rolled_back"
      ? value.status
      : "active";
  const datasourceId =
    typeof value.datasourceId === "string" && value.datasourceId.trim()
      ? value.datasourceId
      : null;
  const metadata = isRecord(value.metadata)
    ? (value.metadata as Record<string, unknown>)
    : null;

  return {
    id: String(value.id ?? ""),
    scope,
    scopeKey: String(value.scopeKey ?? ""),
    datasourceId,
    version: readNumber(value.version, 1),
    anchorType,
    status,
    summary: typeof value.summary === "string" ? value.summary : null,
    rollbackFromAnchorId:
      typeof value.rollbackFromAnchorId === "string"
        ? value.rollbackFromAnchorId
        : null,
    rollbackReason:
      typeof value.rollbackReason === "string" ? value.rollbackReason : null,
    createdByRunId:
      typeof value.createdByRunId === "string" ? value.createdByRunId : null,
    metadata,
    createdAt: String(value.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(value.updatedAt ?? new Date(0).toISOString())
  };
}

function normalizeGlossaryTerm(value: unknown): GlossaryTerm {
  const record = isRecord(value) ? value : {};
  const scope = normalizeGlossaryScope(record.scope);
  const datasourceId =
    typeof record.datasourceId === "string" && record.datasourceId.trim()
      ? record.datasourceId
      : null;
  const metadata = isRecord(record.metadata)
    ? (record.metadata as Record<string, unknown>)
    : null;
  const rawSynonyms = Array.isArray(record.synonyms) ? record.synonyms : [];

  return {
    id: String(record.id ?? ""),
    term: String(record.term ?? ""),
    normalizedTerm: String(
      record.normalizedTerm ?? String(record.term ?? "").toLowerCase()
    ),
    definition: String(record.definition ?? ""),
    synonyms: rawSynonyms
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0),
    scope,
    scopeKey: String(record.scopeKey ?? ""),
    datasourceId,
    priority: readNumber(record.priority, 50),
    conflictResolution: "priority_then_updated_at",
    status: normalizeGlossaryStatus(record.status),
    version: readNumber(record.version, 1),
    versionAnchorId:
      typeof record.versionAnchorId === "string" ? record.versionAnchorId : null,
    rollbackAnchorId:
      typeof record.rollbackAnchorId === "string"
        ? record.rollbackAnchorId
        : null,
    metadata,
    createdAt: String(record.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(record.updatedAt ?? new Date(0).toISOString())
  };
}

function normalizeGlossaryUpsertResponse(value: unknown): UpsertGlossaryTermResponse {
  const record = isRecord(value) ? value : {};
  return {
    term: normalizeGlossaryTerm(record.term),
    linkageStatus: normalizeGlossaryLinkageStatus(record.linkageStatus),
    conflictDecision: normalizeGlossaryConflictDecision(record.conflictDecision),
    activeAnchor: normalizeGlossaryAnchor(record.activeAnchor)
  };
}

function normalizeGlossaryAnchorOrThrow(value: unknown): GlossaryAnchor {
  const anchor = normalizeGlossaryAnchor(value);
  if (!anchor || !anchor.id) {
    throw new AdminApiError("术语锚点响应格式错误。", {
      code: "GLOSSARY_ANCHOR_INVALID_RESPONSE",
      details: value
    });
  }
  return anchor;
}

function normalizeGlossaryAnchorMutationResult(
  value: unknown,
  anchorField: "anchor" | "activeAnchor"
): CreateGlossaryAnchorResult {
  const record = isRecord(value) ? value : {};
  return {
    anchor: normalizeGlossaryAnchorOrThrow(record[anchorField]),
    previousAnchorId:
      typeof record.previousAnchorId === "string" ? record.previousAnchorId : null,
    replayed: Boolean(record.replayed),
    idempotencyKey: String(record.idempotencyKey ?? "")
  };
}

function normalizeRollbackGlossaryAnchorResponse(
  value: unknown
): RollbackGlossaryAnchorResponse {
  const normalized = normalizeGlossaryAnchorMutationResult(value, "activeAnchor");
  return {
    activeAnchor: normalized.anchor,
    previousAnchorId: normalized.previousAnchorId,
    replayed: normalized.replayed,
    idempotencyKey: normalized.idempotencyKey
  };
}

function normalizeListResult<T>(
  payload: unknown,
  listKeys: string[],
  mapper: (value: unknown) => T,
  fallbackPage = 1,
  fallbackPageSize = 10
): PaginatedResult<T> {
  if (Array.isArray(payload)) {
    const items = payload.map((item) => mapper(item));
    return {
      items,
      total: items.length,
      page: fallbackPage,
      pageSize: fallbackPageSize
    };
  }

  const record = isRecord(payload) ? payload : {};
  const rawItems = Array.isArray(record.items)
    ? record.items
    : listKeys.map((key) => record[key]).find((candidate) => Array.isArray(candidate));

  const items = Array.isArray(rawItems) ? rawItems.map((item) => mapper(item)) : [];
  return {
    items,
    total: readNumber(record.total, items.length),
    page: readNumber(record.page, fallbackPage),
    pageSize: readNumber(record.pageSize, fallbackPageSize)
  };
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
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
    throw new AdminApiError(
      `网络请求失败，请检查后端地址与跨域配置。(${error instanceof Error ? error.message : String(error)})`
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    throw new AdminApiError(
      `后端返回了非 JSON 响应（HTTP ${response.status}）。${body.slice(0, 200)}`
    );
  }

  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.status === "error") {
    throw new AdminApiError(payload.error.message, {
      code: payload.error.code,
      details: payload.error.details
    });
  }

  return payload.data;
}

export async function listUsers(
  params: UserListParams = {}
): Promise<PaginatedResult<AdminUser>> {
  const query = toQuery({
    keyword: params.keyword?.trim(),
    status: params.status && params.status !== "all" ? params.status : undefined,
    workspaceId: params.workspaceId,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 10
  });

  try {
    const payload = await request<unknown>(`/api/v1/system/users${query}`);
    return normalizeListResult(payload, ["users"], normalizeUser, params.page ?? 1, params.pageSize ?? 10);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function createUser(input: UserUpsertInput): Promise<AdminUser> {
  try {
    const data = await request<unknown>("/api/v1/system/users", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        variables: toVariableList(input.variables)
      })
    });
    return normalizeUser(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function updateUser(
  userId: string,
  input: Partial<UserUpsertInput>
): Promise<AdminUser> {
  try {
    const payload = {
      ...input,
      ...(input.variables ? { variables: toVariableList(input.variables) } : {})
    };
    const data = await request<unknown>(`/api/v1/system/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return normalizeUser(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function setUserStatus(
  userId: string,
  status: UserStatus
): Promise<AdminUser> {
  try {
    const data = await request<unknown>(`/api/v1/system/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    return normalizeUser(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function resetUserPassword(userId: string): Promise<{
  temporaryPassword?: string;
  message: string;
}> {
  try {
    const data = await request<unknown>(`/api/v1/system/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({})
    });

    const record = isRecord(data) ? data : {};
    const temporaryPassword =
      typeof record.temporaryPassword === "string"
        ? record.temporaryPassword
        : typeof record.defaultPassword === "string"
          ? record.defaultPassword
          : undefined;

    return {
      temporaryPassword,
      message:
        typeof record.message === "string"
          ? record.message
          : "密码已重置，请提醒用户尽快修改默认密码。"
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function deleteUser(userId: string): Promise<{ deleted: boolean }> {
  try {
    const data = await request<unknown>(`/api/v1/system/users/${userId}`, {
      method: "DELETE"
    });
    const record = isRecord(data) ? data : {};
    return { deleted: Boolean(record.deleted ?? true) };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function deleteUsersBatch(userIds: string[]): Promise<{
  deletedCount: number;
  failedCount: number;
}> {
  try {
    const data = await request<unknown>("/api/v1/system/users/batch-delete", {
      method: "POST",
      body: JSON.stringify({ userIds })
    });
    const record = isRecord(data) ? data : {};
    return {
      deletedCount: readNumber(
        record.deletedCount ?? record.successCount,
        userIds.length
      ),
      failedCount: readNumber(record.failedCount, 0)
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function listWorkspaces(
  params: WorkspaceListParams = {}
): Promise<PaginatedResult<WorkspaceSummary>> {
  const query = toQuery({
    keyword: params.keyword?.trim(),
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20
  });

  try {
    const payload = await request<unknown>(`/api/v1/system/workspaces${query}`);
    return normalizeListResult(
      payload,
      ["workspaces"],
      normalizeWorkspace,
      params.page ?? 1,
      params.pageSize ?? 20
    );
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function createWorkspace(input: {
  name: string;
}): Promise<WorkspaceSummary> {
  try {
    const data = await request<unknown>("/api/v1/system/workspaces", {
      method: "POST",
      body: JSON.stringify(input)
    });
    return normalizeWorkspace(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function renameWorkspace(
  workspaceId: string,
  input: { name: string }
): Promise<WorkspaceSummary> {
  try {
    const data = await request<unknown>(`/api/v1/system/workspaces/${workspaceId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
    return normalizeWorkspace(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function deleteWorkspace(workspaceId: string): Promise<{ deleted: boolean }> {
  try {
    const data = await request<unknown>(`/api/v1/system/workspaces/${workspaceId}`, {
      method: "DELETE"
    });
    const record = isRecord(data) ? data : {};
    return { deleted: Boolean(record.deleted ?? true) };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function listWorkspaceMembers(
  workspaceId: string,
  params: {
    keyword?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<PaginatedResult<WorkspaceMember>> {
  const query = toQuery({
    keyword: params.keyword?.trim(),
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 10
  });

  try {
    const payload = await request<unknown>(`/api/v1/system/workspaces/${workspaceId}/members${query}`);
    const result = normalizeListResult(
      payload,
      ["members"],
      normalizeWorkspaceMember,
      params.page ?? 1,
      params.pageSize ?? 10
    );
    if (!isRecord(payload)) {
      return result;
    }
    const pagination = isRecord(payload.pagination) ? payload.pagination : {};
    return {
      ...result,
      total: readNumber(pagination.total, result.total),
      page: readNumber(pagination.page, result.page),
      pageSize: readNumber(pagination.pageSize, result.pageSize)
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function addWorkspaceMembers(
  workspaceId: string,
  members: Array<{ userId: string; role: WorkspaceMemberRole }>
): Promise<{ addedCount: number }> {
  try {
    let addedCount = 0;
    for (const member of members) {
      const data = await request<unknown>(
        `/api/v1/system/workspaces/${workspaceId}/members`,
        {
          method: "POST",
          body: JSON.stringify(member)
        }
      );
      const record = isRecord(data) ? data : {};
      const created =
        typeof record.created === "boolean" ? record.created : true;
      if (created) {
        addedCount += 1;
      }
    }
    return { addedCount };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberId: string,
  role: WorkspaceMemberRole
): Promise<WorkspaceMember> {
  try {
    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/members/${memberId}/role`,
      {
        method: "PATCH",
        body: JSON.stringify({ role })
      }
    );
    if (isRecord(data) && isRecord(data.member)) {
      return normalizeWorkspaceMember(data.member);
    }
    return normalizeWorkspaceMember(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function removeWorkspaceMember(
  workspaceId: string,
  memberId: string
): Promise<{ removed: boolean }> {
  try {
    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/members/${memberId}`,
      {
        method: "DELETE"
      }
    );
    const record = isRecord(data) ? data : {};
    return {
      removed: Boolean(record.removed ?? true)
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function removeWorkspaceMembersBatch(
  workspaceId: string,
  memberIds: string[]
): Promise<{ removedCount: number; failedCount: number }> {
  try {
    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/members/remove-batch`,
      {
        method: "POST",
        body: JSON.stringify({ memberIds })
      }
    );

    const record = isRecord(data) ? data : {};
    return {
      removedCount: readNumber(
        record.removedCount ?? record.successCount,
        memberIds.length
      ),
      failedCount: readNumber(record.failedCount, 0)
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function listWorkspaceDatasourceBindings(
  workspaceId: string
): Promise<WorkspaceDatasourceBinding[]> {
  try {
    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/datasources/bindings`
    );
    const record = isRecord(data) ? data : {};
    const items = Array.isArray(record.items) ? record.items : [];
    return items.map((item) => normalizeWorkspaceDatasourceBinding(item));
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function addWorkspaceDatasourceBindings(
  workspaceId: string,
  datasourceIds: string[]
): Promise<{
  successItems: string[];
  failedItems: Array<{ item: string; code: string; message: string }>;
}> {
  try {
    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`,
      {
        method: "POST",
        body: JSON.stringify({ datasourceIds })
      }
    );
    const record = isRecord(data) ? data : {};
    return {
      successItems: Array.isArray(record.successItems)
        ? record.successItems.map((item) => String(item))
        : [],
      failedItems: Array.isArray(record.failedItems)
        ? record.failedItems
            .filter((item): item is Record<string, unknown> => isRecord(item))
            .map((item) => ({
              item: String(item.item ?? ""),
              code: String(item.code ?? "UNKNOWN"),
              message: String(item.message ?? "")
            }))
        : []
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function removeWorkspaceDatasourceBindings(
  workspaceId: string,
  datasourceIds: string[]
): Promise<{
  successItems: string[];
  failedItems: Array<{ item: string; code: string; message: string }>;
}> {
  try {
    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/datasources/bindings/remove`,
      {
        method: "POST",
        body: JSON.stringify({ datasourceIds })
      }
    );
    const record = isRecord(data) ? data : {};
    return {
      successItems: Array.isArray(record.successItems)
        ? record.successItems.map((item) => String(item))
        : [],
      failedItems: Array.isArray(record.failedItems)
        ? record.failedItems
            .filter((item): item is Record<string, unknown> => isRecord(item))
            .map((item) => ({
              item: String(item.item ?? ""),
              code: String(item.code ?? "UNKNOWN"),
              message: String(item.message ?? "")
            }))
        : []
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function listWorkspaceDatasourceTables(
  workspaceId: string,
  datasourceId: string
): Promise<string[]> {
  try {
    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/datasources/${datasourceId}/tables`
    );
    const record = isRecord(data) ? data : {};
    const items = Array.isArray(record.items) ? record.items : [];
    return items
      .map((item) => String(item).trim().toLowerCase())
      .filter((item) => item.length > 0);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function listWorkspaceDatasourceTablePermissions(
  workspaceId: string,
  datasourceId: string
): Promise<WorkspaceDatasourceTablePermissionsSnapshot> {
  try {
    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/datasources/${datasourceId}/table-permissions`
    );
    const record = isRecord(data) ? data : {};
    const tableNames = normalizeTableNames(record.tableNames);
    const policyVersion = readNumber(record.policyVersion, 0);

    return {
      workspaceId: String(record.workspaceId ?? workspaceId),
      datasourceId: String(record.datasourceId ?? datasourceId),
      tableNames,
      policyVersion
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function replaceWorkspaceDatasourceTablePermissions(
  workspaceId: string,
  datasourceId: string,
  input: ReplaceWorkspaceDatasourceTablePermissionsInput
): Promise<ReplaceWorkspaceDatasourceTablePermissionsResult> {
  try {
    const normalizedTableNames = normalizeTableNames(input.tableNames);
    const normalizedPolicyVersion = Math.max(0, Math.floor(input.policyVersion));
    const normalizedIdempotencyKey = input.idempotencyKey?.trim() || undefined;

    const data = await request<unknown>(
      `/api/v1/system/workspaces/${workspaceId}/datasources/${datasourceId}/table-permissions`,
      {
        method: "PUT",
        headers: normalizedIdempotencyKey
          ? { "x-idempotency-key": normalizedIdempotencyKey }
          : undefined,
        body: JSON.stringify({
          tableNames: normalizedTableNames,
          policyVersion: normalizedPolicyVersion
        })
      }
    );

    const record = isRecord(data) ? data : {};
    const impactSummary = isRecord(record.impactSummary) ? record.impactSummary : {};
    const addedTables = normalizeTableNames(impactSummary.addedTables ?? record.addedTables);
    const removedTables = normalizeTableNames(
      impactSummary.removedTables ?? record.removedTables
    );
    const tableNames = normalizeTableNames(record.tableNames ?? normalizedTableNames);
    const policyVersion = readNumber(record.policyVersion, normalizedPolicyVersion);

    const addedCount = readNumber(impactSummary.addedCount ?? record.addedCount, addedTables.length);
    const removedCount = readNumber(
      impactSummary.removedCount ?? record.removedCount,
      removedTables.length
    );
    const afterCount = readNumber(impactSummary.afterCount ?? record.afterCount, tableNames.length);
    const inferredBeforeCount = Math.max(0, afterCount - addedCount + removedCount);
    const beforeCount = readNumber(
      impactSummary.beforeCount ?? record.beforeCount,
      inferredBeforeCount
    );
    const retainedCount = readNumber(
      impactSummary.retainedCount ?? record.retainedCount,
      Math.max(0, afterCount - addedCount)
    );

    return {
      workspaceId: String(record.workspaceId ?? workspaceId),
      datasourceId: String(record.datasourceId ?? datasourceId),
      tableNames,
      policyVersion,
      beforeCount,
      afterCount,
      addedCount,
      removedCount,
      retainedCount,
      addedTables,
      removedTables
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function listPromptTemplates(
  params: PromptTemplateListParams = {}
): Promise<PaginatedResult<PromptTemplate>> {
  const query = toQuery({
    scene: params.scene && params.scene !== "all" ? params.scene : undefined,
    status: params.status && params.status !== "all" ? params.status : undefined,
    query: params.query?.trim(),
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 100
  });

  try {
    const payload = await request<unknown>(`/api/v1/settings/prompts${query}`);
    const result = normalizeListResult(
      payload,
      ["templates", "promptTemplates"],
      normalizePromptTemplate,
      params.page ?? 1,
      params.pageSize ?? 100
    );
    if (!isRecord(payload)) {
      return result;
    }
    const pagination = isRecord(payload.pagination) ? payload.pagination : {};
    return {
      ...result,
      total: readNumber(pagination.total, result.total),
      page: readNumber(pagination.page, result.page),
      pageSize: readNumber(pagination.pageSize, result.pageSize)
    };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function createPromptTemplate(
  input: PromptTemplateUpsertInput
): Promise<PromptTemplate> {
  try {
    const data = await request<unknown>("/api/v1/settings/prompts", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        scene: input.scene,
        scope: input.scopeType,
        scopeType: input.scopeType,
        scopeKey: input.scopeId?.trim() || undefined,
        scopeId: input.scopeId?.trim() || undefined,
        content: input.content,
        status: input.status
      })
    });
    return normalizePromptTemplateFromPayload(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function updatePromptTemplate(
  templateId: string,
  input: Partial<PromptTemplateUpsertInput>
): Promise<PromptTemplate> {
  try {
    const data = await request<unknown>(`/api/v1/settings/prompts/${templateId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.scene !== undefined ? { scene: input.scene } : {}),
        ...(input.scopeType !== undefined
          ? { scope: input.scopeType, scopeType: input.scopeType }
          : {}),
        ...(input.scopeId !== undefined
          ? {
              scopeKey: input.scopeId?.trim() || undefined,
              scopeId: input.scopeId?.trim() || undefined
            }
          : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      })
    });
    return normalizePromptTemplateFromPayload(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function deletePromptTemplate(
  templateId: string
): Promise<{ deleted: boolean }> {
  try {
    const data = await request<unknown>(`/api/v1/settings/prompts/${templateId}`, {
      method: "DELETE"
    });
    const record = isRecord(data) ? data : {};
    return { deleted: Boolean(record.deleted ?? true) };
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function listGlossaryTerms(
  params: GlossaryListParams = {}
): Promise<PaginatedResult<GlossaryTerm>> {
  const query = toQuery({
    scope: params.scope && params.scope !== "all" ? params.scope : undefined,
    datasourceId: params.datasourceId?.trim(),
    status: params.status && params.status !== "all" ? params.status : undefined,
    query: params.query?.trim(),
    version: params.version,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 100
  });

  try {
    const payload = await request<unknown>(`/api/v1/glossary/terms${query}`);
    return normalizeListResult(
      payload,
      ["terms"],
      normalizeGlossaryTerm,
      params.page ?? 1,
      params.pageSize ?? 100
    );
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function createGlossaryTerm(
  input: CreateGlossaryTermRequest,
  options?: { idempotencyKey?: string }
): Promise<UpsertGlossaryTermResponse> {
  try {
    const data = await request<unknown>("/api/v1/glossary/terms", {
      method: "POST",
      headers: options?.idempotencyKey
        ? { "x-idempotency-key": options.idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    });
    return normalizeGlossaryUpsertResponse(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function updateGlossaryTerm(
  termId: string,
  input: UpdateGlossaryTermRequest,
  options?: { idempotencyKey?: string }
): Promise<UpsertGlossaryTermResponse> {
  try {
    const data = await request<unknown>(`/api/v1/glossary/terms/${termId}`, {
      method: "PATCH",
      headers: options?.idempotencyKey
        ? { "x-idempotency-key": options.idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    });
    return normalizeGlossaryUpsertResponse(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function toggleGlossaryTerm(
  termId: string,
  options?: { idempotencyKey?: string }
): Promise<UpsertGlossaryTermResponse> {
  try {
    const data = await request<unknown>(`/api/v1/glossary/terms/${termId}/toggle`, {
      method: "POST",
      headers: options?.idempotencyKey
        ? { "x-idempotency-key": options.idempotencyKey }
        : undefined,
      body: JSON.stringify({})
    });
    return normalizeGlossaryUpsertResponse(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function listGlossaryAnchors(
  params: GlossaryAnchorListParams = {}
): Promise<PaginatedResult<GlossaryAnchor>> {
  const query = toQuery({
    scope: params.scope && params.scope !== "all" ? params.scope : undefined,
    datasourceId: params.datasourceId?.trim(),
    anchorType:
      params.anchorType && params.anchorType !== "all" ? params.anchorType : undefined,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20
  });

  try {
    const payload = await request<unknown>(`/api/v1/glossary/anchors${query}`);
    return normalizeListResult(
      payload,
      ["anchors"],
      normalizeGlossaryAnchorOrThrow,
      params.page ?? 1,
      params.pageSize ?? 20
    );
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function createGlossaryAnchor(
  input: CreateGlossaryAnchorRequest,
  options?: { idempotencyKey?: string }
): Promise<CreateGlossaryAnchorResult> {
  try {
    const data = await request<unknown>("/api/v1/glossary/anchors", {
      method: "POST",
      headers: options?.idempotencyKey
        ? { "x-idempotency-key": options.idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    });
    return normalizeGlossaryAnchorMutationResult(data, "anchor");
  } catch (error) {
    throw toAdminApiError(error);
  }
}

export async function rollbackGlossaryAnchor(
  input: RollbackGlossaryAnchorRequest,
  options?: { idempotencyKey?: string }
): Promise<RollbackGlossaryAnchorResponse> {
  try {
    const data = await request<unknown>("/api/v1/glossary/anchors/rollback", {
      method: "POST",
      headers: options?.idempotencyKey
        ? { "x-idempotency-key": options.idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    });
    return normalizeRollbackGlossaryAnchorResponse(data);
  } catch (error) {
    throw toAdminApiError(error);
  }
}
