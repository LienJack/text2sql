"use client";

import { Building2, Search, Settings2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LlmSettingsView, ModelCatalogItem } from "@text2sql/shared-types";
import { ModelCatalogTable } from "@/components/settings/model-catalog-table";
import { ProviderConfigSheet } from "@/components/settings/provider-config-sheet";
import { UsersManagementPanel } from "@/components/settings/users-management-panel";
import { WorkspaceManagementPanel } from "@/components/settings/workspace-management-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type SettingsTab = "models" | "users";
type ManagementTab = "users" | "workspaces";

export default function SettingsPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SettingsTab>("models");
  const [query, setQuery] = useState("");
  const [managementTab, setManagementTab] = useState<ManagementTab>("users");
  const [managementRefreshToken, setManagementRefreshToken] = useState(0);
  const [view, setView] = useState<LlmSettingsView | null>(null);
  const [supportedProviders, setSupportedProviders] = useState<
    Array<{
      provider: LlmSettingsView["models"][number]["provider"];
      displayName: string;
      defaultBaseUrl: string;
      supportsModelListing: boolean;
    }>
  >([]);

  const load = async (mode: "initial" | "refresh" = "refresh") => {
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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载设置数据失败");
    } finally {
      if (mode === "initial") {
        setInitialLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

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

  /** 用写接口的返回值直接 patch 单条 model，省掉一次查询请求 */
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
  }, []);

  const modelRows = useMemo(() => {
    const rows = view?.models ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter((row) =>
      `${row.provider} ${row.model} ${row.displayName}`.toLowerCase().includes(keyword)
    );
  }, [query, view?.models]);

  const actorRole = view?.actor.role ?? "user";
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
      providers: view.providers.filter((provider) => modelsByProvider.has(provider.id) || !query.trim())
    };
  }, [modelRows, query, view]);

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1400px] flex-col gap-4 bg-[var(--surface-page)] p-4 sm:p-6">
      <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:flex sm:items-center sm:justify-between sm:space-y-0">
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)} className="w-full sm:w-auto">
          <TabsList className="h-10">
            <TabsTrigger value="models">
              <Settings2 className="h-3.5 w-3.5" />
              LLM 模型
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="h-3.5 w-3.5" />
              用户与权限
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
                className="pl-9"
                placeholder="搜索模型..."
              />
            </div>
          ) : (
            <p className="hidden text-sm text-[var(--text-secondary)] sm:block">
              用户与工作空间治理面板
            </p>
          )}
          <Button
            onClick={() => {
              if (tab === "models") {
                void load();
              } else {
                setManagementRefreshToken((previous) => previous + 1);
              }
            }}
          >
            {refreshing ? "刷新中..." : "刷新"}
          </Button>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        {initialLoading && !view ? <StateBlock variant="loading">正在加载设置数据...</StateBlock> : null}
        {error ? <StateBlock variant="error">{error}</StateBlock> : null}

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
                  installedProviderCodes={(view?.providers ?? []).map((item) => item.provider)}
                  onCreateProvider={async (payload) => {
                    try {
                      await createProviderConfig(payload);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "创建厂商配置失败");
                    } finally {
                      await load("refresh");
                    }
                  }}
                />
              ) : (
                <StateBlock variant="idle">当前账号仅可查看与切换模型，不可管理配置。</StateBlock>
              )}
            </div>
          ) : (
            <Tabs value={managementTab} onValueChange={(value) => setManagementTab(value as ManagementTab)}>
              <TabsList className="h-10">
                <TabsTrigger value="users">
                  <Users className="h-3.5 w-3.5" />
                  用户管理
                </TabsTrigger>
                <TabsTrigger value="workspaces">
                  <Building2 className="h-3.5 w-3.5" />
                  工作空间
                </TabsTrigger>
              </TabsList>

              <TabsContent value="users" className="pt-4">
                <UsersManagementPanel actorRole={actorRole} refreshToken={managementRefreshToken} />
              </TabsContent>
              <TabsContent value="workspaces" className="pt-4">
                <WorkspaceManagementPanel actorRole={actorRole} refreshToken={managementRefreshToken} />
              </TabsContent>
            </Tabs>
          )
        ) : null}
      </section>
    </div>
  );
}
