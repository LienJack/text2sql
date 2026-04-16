"use client";

import { Building2, Search, Settings2, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LlmSettingsView, ModelCatalogItem } from "@text2sql/shared-types";
import { ModelCatalogTable } from "@/components/settings/model-catalog-table";
import { ProviderConfigSheet } from "@/components/settings/provider-config-sheet";
import { UsersManagementPanel } from "@/components/settings/users-management-panel";
import { WorkspaceManagementPanel } from "@/components/settings/workspace-management-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listWorkspaces, type WorkspaceSummary } from "@/lib/admin-api-client";
import { readActiveWorkspaceId, writeActiveWorkspaceId } from "@/lib/datasource-session-context";
import {
  batchSetModelsEnabled,
  checkProviderHealth,
  createProviderConfig,
  deleteProviderConfig,
  fetchModelStatuses,
  fetchSettingsView,
  fetchSupportedProviders,
  setModelEnabled,
  syncProviderModels
} from "@/lib/settings-api-client";

type SettingsTab = "users" | "workspaces" | "models";
const ADMIN_TABS: SettingsTab[] = ["users", "workspaces", "models"];
const USER_TABS: SettingsTab[] = ["models"];

function readWorkspaceIdFromQuery(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return new URLSearchParams(window.location.search).get("workspaceId")?.trim() ?? "";
}

function syncWorkspaceContext(workspaceId: string): void {
  writeActiveWorkspaceId(workspaceId);
  if (typeof window === "undefined") {
    return;
  }
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = new URL(window.location.href);
  if (workspaceId) {
    next.searchParams.set("workspaceId", workspaceId);
  } else {
    next.searchParams.delete("workspaceId");
  }
  const nextPath = `${next.pathname}${next.search}${next.hash}`;
  if (nextPath !== current) {
    window.history.replaceState({}, "", nextPath);
  }
}

function resolveWorkspaceId(
  items: WorkspaceSummary[],
  previousWorkspaceId: string
): string {
  if (items.length === 0) {
    return "";
  }
  const fromQuery = readWorkspaceIdFromQuery();
  const fromSession = readActiveWorkspaceId();
  const candidate = [fromQuery, fromSession, previousWorkspaceId, items[0]?.id]
    .map((value) => value?.trim() ?? "")
    .find((value) => value.length > 0);
  if (!candidate) {
    return items[0]?.id ?? "";
  }
  return items.some((workspace) => workspace.id === candidate)
    ? candidate
    : (items[0]?.id ?? "");
}

export default function SettingsPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SettingsTab>("users");
  const [query, setQuery] = useState("");
  const [managementRefreshToken, setManagementRefreshToken] = useState(0);
  const [view, setView] = useState<LlmSettingsView | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [supportedProviders, setSupportedProviders] = useState<
    Array<{
      provider: LlmSettingsView["models"][number]["provider"];
      displayName: string;
      defaultBaseUrl: string;
      supportsModelListing: boolean;
    }>
  >([]);

  const loadWorkspaceOptions = useCallback(async (enabled: boolean): Promise<void> => {
    if (!enabled) {
      setWorkspaces([]);
      setWorkspaceId("");
      setWorkspaceError("");
      return;
    }

    setWorkspaceLoading(true);
    try {
      const result = await listWorkspaces({ page: 1, pageSize: 200 });
      setWorkspaces(result.items);
      setWorkspaceError("");
      setWorkspaceId((previous) => {
        const nextWorkspaceId = resolveWorkspaceId(result.items, previous);
        syncWorkspaceContext(nextWorkspaceId);
        return nextWorkspaceId;
      });
    } catch (workspaceLoadError) {
      setWorkspaceError(
        workspaceLoadError instanceof Error
          ? workspaceLoadError.message
          : "加载工作空间失败"
      );
      setWorkspaces([]);
      setWorkspaceId("");
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (mode === "initial") {
        setInitialLoading(true);
      } else {
        setRefreshing(true);
      }
      setError("");
      try {
        const [settingsView, providerOptions] = await Promise.all([
          fetchSettingsView(),
          fetchSupportedProviders()
        ]);
        setView(settingsView);
        setSupportedProviders(providerOptions);
        await loadWorkspaceOptions(settingsView.actor.role === "admin");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载设置数据失败");
      } finally {
        if (mode === "initial") {
          setInitialLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [loadWorkspaceOptions]
  );

  const refreshModels = async () => {
    try {
      const statuses = await fetchModelStatuses();
      const statusMap = new Map(statuses.map((s) => [s.id, s.enabled]));
      setView((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          models: prev.models.map((m) => {
            const next = statusMap.get(m.id);
            return next !== undefined ? { ...m, enabled: next } : m;
          })
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新模型状态失败");
    }
  };

  const patchModel = (updated: ModelCatalogItem | undefined) => {
    if (!updated?.id) {
      void refreshModels();
      return;
    }
    setView((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        models: prev.models.map((m) => (m.id === updated.id ? updated : m))
      };
    });
  };

  useEffect(() => {
    void load("initial");
  }, [load]);

  const modelRows = useMemo(() => {
    const rows = view?.models ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter((row) =>
      `${row.provider} ${row.model} ${row.displayName}`
        .toLowerCase()
        .includes(keyword)
    );
  }, [query, view?.models]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
    [workspaceId, workspaces]
  );
  const actorRole = view?.actor.role ?? "user";
  const availableTabs = actorRole === "admin" ? ADMIN_TABS : USER_TABS;
  const busy = initialLoading || refreshing;

  const filteredView = useMemo(() => {
    if (!view) {
      return view;
    }
    const modelsByProvider = new Map<string, ModelCatalogItem[]>();
    for (const row of modelRows) {
      const list = modelsByProvider.get(row.providerConfigId) ?? [];
      list.push(row);
      modelsByProvider.set(row.providerConfigId, list);
    }
    return {
      ...view,
      models: modelRows,
      providers: view.providers.filter(
        (provider) => modelsByProvider.has(provider.id) || !query.trim()
      )
    };
  }, [modelRows, query, view]);

  useEffect(() => {
    if (!availableTabs.includes(tab)) {
      setTab(availableTabs[0] ?? "models");
    }
  }, [availableTabs, tab]);

  const governanceTab = actorRole === "admin" && tab === "users";

  return (
    <div className="relative flex h-[calc(100vh-4rem)] w-full flex-col gap-3 bg-[var(--surface-page)] px-4 py-3 sm:px-6 sm:py-4">
      <section className="space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-[var(--action-primary)] uppercase">
              <ShieldCheck className="h-3.5 w-3.5" />
              Governance Console
            </p>
            <h2
              className="text-[22px] font-semibold leading-tight text-[var(--text-primary)] [font-family:'Avenir_Next_Condensed','DIN_Alternate','Alibaba_PuHuiTi_3.0','PingFang_SC','Noto_Sans_SC',sans-serif]"
            >
              系统设置与权限编排
            </h2>
          </div>
          <span className="rounded-full border border-[rgba(148,163,184,0.45)] bg-[rgba(248,250,252,0.7)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
            {tab === "models" ? "模型治理视图" : "组织治理视图"}
          </span>
        </div>

        <div className="space-y-3 sm:flex sm:items-center sm:justify-between sm:space-y-0">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as SettingsTab)}
            className="w-full sm:w-auto"
          >
            <TabsList className="h-11 rounded-full border border-[rgba(148,163,184,0.44)] bg-[rgba(241,245,249,0.62)] p-1">
              {actorRole === "admin" ? (
                <>
                  <TabsTrigger
                    value="users"
                    className="rounded-full px-4 data-active:bg-[rgba(37,99,235,0.14)] data-active:text-[var(--action-primary-hover)]"
                  >
                    <Users className="h-3.5 w-3.5" />
                    用户列表
                  </TabsTrigger>
                  <TabsTrigger
                    value="workspaces"
                    className="rounded-full px-4 data-active:bg-[rgba(37,99,235,0.14)] data-active:text-[var(--action-primary-hover)]"
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    工作空间
                  </TabsTrigger>
                </>
              ) : null}
              <TabsTrigger
                value="models"
                className="rounded-full px-4 data-active:bg-[rgba(37,99,235,0.14)] data-active:text-[var(--action-primary-hover)]"
              >
                <Settings2 className="h-3.5 w-3.5" />
                LLM 模型
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            {tab === "models" ? (
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="border-[rgba(148,163,184,0.5)] bg-white/80 pl-9"
                  placeholder="搜索模型..."
                />
              </div>
            ) : governanceTab ? (
              actorRole === "admin" ? (
                <div className="min-w-[220px]">
                  <NativeSelect
                    value={workspaceId}
                    disabled={workspaceLoading || workspaces.length === 0}
                    onChange={(event) => {
                      const nextWorkspaceId = event.target.value;
                      setWorkspaceId(nextWorkspaceId);
                      syncWorkspaceContext(nextWorkspaceId);
                      setManagementRefreshToken((previous) => previous + 1);
                    }}
                    className="border-[rgba(148,163,184,0.45)] bg-white/80"
                  >
                    <NativeSelectOption value="">请选择工作空间</NativeSelectOption>
                    {workspaces.map((workspace) => (
                      <NativeSelectOption key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              ) : (
                <p className="hidden text-sm text-[var(--text-secondary)] sm:block">
                  当前账号不可管理治理配置
                </p>
              )
            ) : (
              <p className="hidden text-sm text-[var(--text-secondary)] sm:block">
                工作空间与成员管理
              </p>
            )}
            <Button
              className="shadow-[0_8px_20px_rgba(37,99,235,0.22)]"
              onClick={() => {
                if (tab === "models") {
                  void load();
                  return;
                }
                if (actorRole === "admin") {
                  void loadWorkspaceOptions(true);
                }
                setManagementRefreshToken((previous) => previous + 1);
              }}
            >
              {refreshing || workspaceLoading ? "刷新中..." : "刷新"}
            </Button>
          </div>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
        {initialLoading && !view ? (
          <StateBlock variant="loading">正在加载设置数据...</StateBlock>
        ) : null}
        {error ? <StateBlock variant="error">{error}</StateBlock> : null}
        {governanceTab && workspaceError ? (
          <StateBlock variant="error">{workspaceError}</StateBlock>
        ) : null}
        {governanceTab && selectedWorkspace ? (
          <StateBlock variant="idle">
            当前治理作用域：{selectedWorkspace.name}
          </StateBlock>
        ) : null}

        {view ? (
          tab === "models" ? (
            <div className="space-y-4">
              <ModelCatalogTable
                actorRole={actorRole}
                providers={filteredView?.providers ?? []}
                models={filteredView?.models ?? []}
                loading={busy}
                onSyncProvider={async (providerConfigId) => {
                  try {
                    await syncProviderModels(providerConfigId);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "同步模型失败");
                  } finally {
                    await load("refresh");
                  }
                }}
                onCheckProvider={async (providerConfigId) => {
                  try {
                    await checkProviderHealth(providerConfigId);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "检测连通性失败");
                  } finally {
                    await load("refresh");
                  }
                }}
                onDeleteProvider={async (providerConfigId) => {
                  try {
                    await deleteProviderConfig(providerConfigId);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "删除厂商失败");
                  } finally {
                    await load("refresh");
                  }
                }}
                onSetModelEnabled={async (modelId, enabled) => {
                  try {
                    const updated = await setModelEnabled(modelId, enabled);
                    patchModel(updated);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "切换模型状态失败");
                  }
                }}
                onBatchSetModels={async (modelIds, enabled) => {
                  if (modelIds.length === 0) {
                    return;
                  }
                  try {
                    await batchSetModelsEnabled(modelIds, enabled);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "批量操作失败");
                  }
                  await refreshModels();
                }}
              />

              {actorRole === "admin" ? (
                <ProviderConfigSheet
                  loading={busy}
                  supportedProviders={supportedProviders}
                  installedProviderCodes={(view?.providers ?? []).map(
                    (item) => item.provider
                  )}
                  onCreateProvider={async (payload) => {
                    try {
                      await createProviderConfig(payload);
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "创建厂商配置失败"
                      );
                    } finally {
                      await load("refresh");
                    }
                  }}
                />
              ) : (
                <StateBlock variant="idle">
                  当前账号仅可查看与切换模型，不可管理配置。
                </StateBlock>
              )}
            </div>
          ) : tab === "users" ? (
            <UsersManagementPanel
              actorRole={actorRole}
              workspaceScopeId={workspaceId}
              workspaceScopeName={selectedWorkspace?.name}
              refreshToken={managementRefreshToken}
            />
          ) : (
            <div className="space-y-4">
              <StateBlock variant="idle">
                在此维护工作空间、成员与数据源绑定关系。
              </StateBlock>
              <WorkspaceManagementPanel
                actorRole={actorRole}
                refreshToken={managementRefreshToken}
              />
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
