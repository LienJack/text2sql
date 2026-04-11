"use client";

import { Search, Settings2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LlmSettingsView, ModelCatalogItem } from "@text2sql/shared-types";
import { ModelCatalogTable } from "@/components/settings/model-catalog-table";
import { ProviderConfigSheet } from "@/components/settings/provider-config-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type PlatformUser, fetchSettingsView as fetchMockSettingsView } from "@/lib/platform-mock-adapter";
import {
  checkProviderHealth,
  createProviderConfig,
  deleteProviderConfig,
  fetchSettingsView,
  fetchSupportedProviders,
  setModelEnabled,
  syncProviderModels
} from "@/lib/settings-api-client";

type SettingsTab = "models" | "users";

export default function SettingsPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SettingsTab>("models");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LlmSettingsView | null>(null);
  const [users, setUsers] = useState<PlatformUser[]>([]);
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
      const [settingsView, providerOptions, mockView] = await Promise.all([
        fetchSettingsView(),
        fetchSupportedProviders(),
        fetchMockSettingsView()
      ]);
      setView(settingsView);
      setSupportedProviders(providerOptions);
      setUsers(mockView.users);
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

  const userRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return users;
    }
    return users.filter((row) =>
      `${row.name} ${row.email} ${row.role} ${row.department}`.toLowerCase().includes(keyword)
    );
  }, [query, users]);

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
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex sm:items-center sm:justify-between sm:space-y-0">
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
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder={tab === "models" ? "搜索模型..." : "搜索用户..."}
            />
          </div>
          <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={() => void load()}>
            {refreshing ? "刷新中..." : "刷新"}
          </Button>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {initialLoading && !view ? <StateBlock variant="loading">正在加载设置数据...</StateBlock> : null}
        {refreshing && view ? <StateBlock variant="loading">正在刷新数据...</StateBlock> : null}
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
                  await syncProviderModels(providerConfigId);
                  await load("refresh");
                }}
                onCheckProvider={async (providerConfigId) => {
                  await checkProviderHealth(providerConfigId);
                  await load("refresh");
                }}
                onDeleteProvider={async (providerConfigId) => {
                  await deleteProviderConfig(providerConfigId);
                  await load("refresh");
                }}
                onSetModelEnabled={async (modelId, enabled) => {
                  await setModelEnabled(modelId, enabled);
                  await load("refresh");
                }}
                onBatchSetModels={async (modelIds, enabled) => {
                  if (modelIds.length === 0) {
                    return;
                  }
                  await Promise.all(modelIds.map((modelId) => setModelEnabled(modelId, enabled)));
                  await load("refresh");
                }}
              />
              {actorRole === "admin" ? (
                <ProviderConfigSheet
                  loading={busy}
                  supportedProviders={supportedProviders}
                  installedProviderCodes={(view?.providers ?? []).map((item) => item.provider)}
                  onCreateProvider={async (payload) => {
                    await createProviderConfig(payload);
                    await load("refresh");
                  }}
                />
              ) : (
                <StateBlock variant="idle">当前账号仅可查看与切换模型，不可管理配置。</StateBlock>
              )}
            </div>
          ) : (
            <UsersTable rows={userRows} />
          )
        ) : null}
      </section>
    </div>
  );
}

function UsersTable({ rows }: { rows: PlatformUser[] }) {
  if (rows.length === 0) {
    return <StateBlock variant="idle">暂无可展示用户数据。</StateBlock>;
  }

  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow>
          <TableHead className="w-[260px]">用户</TableHead>
          <TableHead className="w-[160px]">角色</TableHead>
          <TableHead className="w-[140px]">部门</TableHead>
          <TableHead className="w-[140px]">状态</TableHead>
          <TableHead className="w-[180px]">最近登录</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((user) => (
          <TableRow key={user.id}>
            <TableCell>
              <p className="font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </TableCell>
            <TableCell className="text-sm text-slate-700">{user.role}</TableCell>
            <TableCell className="text-sm text-slate-600">{user.department}</TableCell>
            <TableCell>
              <span className="text-sm font-medium text-slate-600">
                {user.status === "active" ? "正常" : "停用"}
              </span>
            </TableCell>
            <TableCell className="text-sm text-slate-500">{user.lastLogin}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
