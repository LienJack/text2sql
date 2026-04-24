"use client";

import Link from "next/link";
import {
  Activity,
  Building2,
  Search,
  Settings2,
  ShieldCheck,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  GlossaryAnchor,
  LlmSettingsView,
  ModelCatalogItem,
  RagMemoryStatus,
  RagQualityGateReport,
  RagReplayCompletenessReport,
  RollbackGlossaryAnchorResponse,
  SqlRun
} from "@text2sql/shared-types";
import { RagFoundationStatusCard } from "@/components/chat/rag-foundation-status-card";
import { ModelCatalogTable } from "@/components/settings/model-catalog-table";
import { ProviderConfigSheet } from "@/components/settings/provider-config-sheet";
import { UsersManagementPanel } from "@/components/settings/users-management-panel";
import { WorkspaceManagementPanel } from "@/components/settings/workspace-management-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AdminApiError,
  createGlossaryAnchor,
  listGlossaryAnchors,
  listWorkspaces,
  rollbackGlossaryAnchor,
  type WorkspaceSummary
} from "@/lib/admin-api-client";
import { getRun } from "@/lib/api-client";
import { readActiveWorkspaceId, writeActiveWorkspaceId } from "@/lib/datasource-session-context";
import {
  batchSetModelsEnabled,
  checkProviderHealth,
  createProviderConfig,
  extractRagFoundationSnapshot,
  deleteProviderConfig,
  fetchBackendHealthSnapshot,
  fetchModelStatuses,
  fetchRagQualityReport,
  fetchRagReplayCompleteness,
  fetchSettingsView,
  fetchSupportedProviders,
  resolveRagQualityLatestRunId,
  setModelEnabled,
  submitRagMemoryFeedback,
  syncProviderModels
} from "@/lib/settings-api-client";

type SettingsTab = "users" | "workspaces" | "models" | "rag";
type RagRunSource = "deep-link" | "latest-run" | "none";
const ADMIN_TABS: SettingsTab[] = ["users", "workspaces", "models", "rag"];
const USER_TABS: SettingsTab[] = ["models", "rag"];

function readWorkspaceIdFromQuery(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return new URLSearchParams(window.location.search).get("workspaceId")?.trim() ?? "";
}

function readRunIdFromQuery(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return new URLSearchParams(window.location.search).get("runId")?.trim() ?? "";
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
  const fromSession = readActiveWorkspaceId();
  const fromQuery = readWorkspaceIdFromQuery();
  const candidate = [fromSession, fromQuery, previousWorkspaceId, items[0]?.id]
    .map((value) => value?.trim() ?? "")
    .find((value) => value.length > 0);
  if (!candidate) {
    return items[0]?.id ?? "";
  }
  return items.some((workspace) => workspace.id === candidate)
    ? candidate
    : (items[0]?.id ?? "");
}

function formatGovernanceError(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "FORBIDDEN") {
      return `无权限（403）：${error.message}`;
    }
    return error.code ? `${error.message}（${error.code}）` : error.message;
  }
  return error instanceof Error ? error.message : "术语锚点治理操作失败";
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
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState("");
  const [ragFoundationError, setRagFoundationError] = useState("");
  const [ragHealth, setRagHealth] = useState<
    Awaited<ReturnType<typeof fetchBackendHealthSnapshot>> | null
  >(null);
  const [ragQuality, setRagQuality] = useState<RagQualityGateReport | null>(null);
  const [ragReplay, setRagReplay] = useState<RagReplayCompletenessReport | null>(null);
  const [ragRun, setRagRun] = useState<SqlRun | null>(null);
  const [glossaryAnchors, setGlossaryAnchors] = useState<GlossaryAnchor[]>([]);
  const [glossaryAnchorError, setGlossaryAnchorError] = useState("");
  const [activeGlossaryAnchorText, setActiveGlossaryAnchorText] = useState("暂无锚点");
  const [latestRollbackAnchorText, setLatestRollbackAnchorText] = useState("暂无回滚记录");
  const [anchorVersionInput, setAnchorVersionInput] = useState("1");
  const [anchorSummaryInput, setAnchorSummaryInput] = useState("");
  const [rollbackTargetAnchorId, setRollbackTargetAnchorId] = useState("");
  const [rollbackReasonInput, setRollbackReasonInput] = useState("");
  const [governanceActionMessage, setGovernanceActionMessage] = useState("");
  const [latestRollbackResult, setLatestRollbackResult] =
    useState<RollbackGlossaryAnchorResponse | null>(null);
  const [anchorSubmitting, setAnchorSubmitting] = useState(false);
  const [rollbackSubmitting, setRollbackSubmitting] = useState(false);
  const [ragRunId, setRagRunId] = useState("");
  const [ragRunSource, setRagRunSource] = useState<RagRunSource>("none");
  const [feedbackRunId, setFeedbackRunId] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<RagMemoryStatus>("verified");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");

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

  const loadRagView = useCallback(async (): Promise<void> => {
    setRagLoading(true);
    setRagError("");
    setRagFoundationError("");
    setGlossaryAnchorError("");

    const deepLinkRunId = readRunIdFromQuery();
    const ragErrors: string[] = [];
    let quality: RagQualityGateReport | null = null;
    const [healthResult, qualityResult, glossaryAnchorsResult] = await Promise.allSettled([
      fetchBackendHealthSnapshot(),
      fetchRagQualityReport(),
      listGlossaryAnchors({ page: 1, pageSize: 50 })
    ]);

    if (healthResult.status === "fulfilled") {
      setRagHealth(healthResult.value);
    } else {
      setRagHealth(null);
      setRagFoundationError(
        healthResult.reason instanceof Error
          ? healthResult.reason.message
          : "health 请求失败"
      );
    }

    if (qualityResult.status === "fulfilled") {
      quality = qualityResult.value;
      setRagQuality(quality);
    } else {
      setRagQuality(null);
      ragErrors.push(
        qualityResult.reason instanceof Error
          ? qualityResult.reason.message
          : "加载 RAG 质量报告失败"
      );
    }

    if (glossaryAnchorsResult.status === "fulfilled") {
      const items = glossaryAnchorsResult.value.items;
      setGlossaryAnchors(items);
      const activeAnchor = items.find((item) => item.status === "active") ?? null;
      const latestRollback = items.find((item) => item.anchorType === "rollback") ?? null;
      setRollbackTargetAnchorId((previous) => previous || activeAnchor?.id || "");
      setActiveGlossaryAnchorText(
        activeAnchor
          ? `${activeAnchor.anchorType} · v${activeAnchor.version} · ${activeAnchor.scopeKey}`
          : "暂无锚点"
      );
      setLatestRollbackAnchorText(
        latestRollback
          ? `v${latestRollback.version} · from=${latestRollback.rollbackFromAnchorId ?? "unknown"}${
              latestRollback.rollbackReason ? ` · ${latestRollback.rollbackReason}` : ""
            }`
          : "暂无回滚记录"
      );
    } else {
      setGlossaryAnchors([]);
      setActiveGlossaryAnchorText("暂无锚点");
      setLatestRollbackAnchorText("暂无回滚记录");
      setGlossaryAnchorError(
        glossaryAnchorsResult.reason instanceof Error
          ? glossaryAnchorsResult.reason.message
          : "加载术语锚点失败"
      );
    }

    const latestRunId = resolveRagQualityLatestRunId(quality);
    const targetRunId = deepLinkRunId || latestRunId || "";
    const runSource: RagRunSource = deepLinkRunId
      ? "deep-link"
      : latestRunId
        ? "latest-run"
        : "none";
    setRagRunSource(runSource);
    setRagRunId(targetRunId);

    if (!targetRunId) {
      setRagRun(null);
      setRagReplay(null);
      setRagError(ragErrors.join("；"));
      setRagLoading(false);
      return;
    }

    const [runResult, replayResult] = await Promise.allSettled([
      getRun(targetRunId),
      fetchRagReplayCompleteness(targetRunId)
    ]);

    if (runResult.status === "fulfilled") {
      setRagRun(runResult.value);
    } else {
      setRagRun(null);
      ragErrors.push(
        runResult.reason instanceof Error
          ? runResult.reason.message
          : "加载运行详情失败"
      );
    }

    if (replayResult.status === "fulfilled") {
      setRagReplay(replayResult.value);
    } else {
      setRagReplay(null);
      ragErrors.push(
        replayResult.reason instanceof Error
          ? replayResult.reason.message
          : "加载回放完整性失败"
      );
    }

    setRagError(ragErrors.join("；"));
    setRagLoading(false);
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
        await Promise.all([
          loadWorkspaceOptions(settingsView.actor.role === "admin"),
          loadRagView()
        ]);
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
    [loadRagView, loadWorkspaceOptions]
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

  useEffect(() => {
    if (ragRunId && !feedbackRunId) {
      setFeedbackRunId(ragRunId);
    }
  }, [feedbackRunId, ragRunId]);

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
  const foundationSnapshot = useMemo(
    () => extractRagFoundationSnapshot(ragHealth),
    [ragHealth]
  );

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
  const semanticEvidence = ragRun?.delivery?.evidence;
  const latestQualityRunId = resolveRagQualityLatestRunId(ragQuality);
  const semanticVersionText =
    semanticEvidence?.semanticVersion ?? "版本不可用（字段缺失）";
  const semanticLockStatusText =
    semanticEvidence?.semanticLockStatus ?? "锁状态不可用（字段缺失）";
  const semanticDegradeReasonText =
    semanticEvidence?.semanticDegradeReason ?? "未触发（字段缺失或未降级）";
  const semanticDegradeTriggered = Boolean(semanticEvidence?.semanticDegradeReason);
  const skillContextSummaryText = semanticEvidence?.skillContextSummary
    ? `skills=${semanticEvidence.skillContextSummary.skillCount}, context=${semanticEvidence.skillContextSummary.contextCount}${
        semanticEvidence.skillContextSummary.degradeReason
          ? `, degradeReason=${semanticEvidence.skillContextSummary.degradeReason}`
          : ", degradeReason=未上报"
      }`
    : "skills=0（字段缺失）, context=0（字段缺失）, degradeReason=不可用（字段缺失）";
  const canSubmitFeedback = actorRole === "admin" && feedbackRunId.trim().length > 0;
  const anchorCandidates = useMemo(
    () =>
      glossaryAnchors.filter(
        (anchor) => anchor.anchorType === "release" || anchor.anchorType === "rollback"
      ),
    [glossaryAnchors]
  );

  const submitFeedback = async (): Promise<void> => {
    if (!canSubmitFeedback) {
      return;
    }
    setFeedbackSubmitting(true);
    setFeedbackMessage("");
    try {
      const result = await submitRagMemoryFeedback({
        runId: feedbackRunId.trim(),
        targetStatus: feedbackStatus,
        note: feedbackNote.trim() || undefined
      });
      setFeedbackMessage(
        result.applied
          ? `已更新记忆状态：${result.beforeStatus} -> ${result.afterStatus}`
          : `状态未变化，当前为 ${result.afterStatus}`
      );
      await loadRagView();
    } catch (submitError) {
      setFeedbackMessage(
        submitError instanceof Error ? submitError.message : "提交记忆反馈失败"
      );
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const submitCreateAnchor = async (): Promise<void> => {
    if (actorRole !== "admin") {
      setGovernanceActionMessage("当前账号无权创建锚点。");
      return;
    }
    const version = Number.parseInt(anchorVersionInput.trim(), 10);
    if (!Number.isFinite(version) || version <= 0) {
      setGovernanceActionMessage("版本号必须是大于 0 的整数。");
      return;
    }

    setAnchorSubmitting(true);
    setGovernanceActionMessage("");
    try {
      const result = await createGlossaryAnchor({
        scope: "global",
        version,
        summary: anchorSummaryInput.trim() || undefined
      });
      setGovernanceActionMessage(
        result.replayed
          ? `锚点已存在，复用 ${result.anchor.id}（v${result.anchor.version}）`
          : `已创建锚点 ${result.anchor.id}（v${result.anchor.version}）`
      );
      setAnchorSummaryInput("");
      await loadRagView();
    } catch (submitError) {
      setGovernanceActionMessage(formatGovernanceError(submitError));
    } finally {
      setAnchorSubmitting(false);
    }
  };

  const submitRollbackAnchor = async (): Promise<void> => {
    if (actorRole !== "admin") {
      setGovernanceActionMessage("当前账号无权执行回滚。");
      return;
    }
    const targetAnchorId = rollbackTargetAnchorId.trim();
    if (!targetAnchorId) {
      setGovernanceActionMessage("请先选择或输入要回滚到的锚点 ID。");
      return;
    }

    setRollbackSubmitting(true);
    setGovernanceActionMessage("");
    try {
      const result = await rollbackGlossaryAnchor({
        scope: "global",
        targetAnchorId,
        rollbackReason: rollbackReasonInput.trim() || undefined
      });
      setLatestRollbackResult(result);
      setGovernanceActionMessage(
        result.replayed
          ? `回滚目标已激活：${result.activeAnchor.id}`
          : `回滚完成，当前锚点 ${result.activeAnchor.id}`
      );
      setRollbackReasonInput("");
      await loadRagView();
    } catch (submitError) {
      setGovernanceActionMessage(formatGovernanceError(submitError));
    } finally {
      setRollbackSubmitting(false);
    }
  };

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
            {tab === "models"
              ? "模型治理视图"
              : tab === "rag"
                ? "RAG 运行视图"
                : "组织治理视图"}
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
              <TabsTrigger
                value="rag"
                className="rounded-full px-4 data-active:bg-[rgba(37,99,235,0.14)] data-active:text-[var(--action-primary-hover)]"
              >
                <Activity className="h-3.5 w-3.5" />
                RAG 运行
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
                <p className="hidden text-sm text-[var(--text-secondary)] sm:block">
                  {workspaceLoading
                    ? "正在加载工作空间..."
                    : selectedWorkspace
                      ? `当前工作空间：${selectedWorkspace.name}`
                      : "当前无可用工作空间"}
                </p>
              ) : (
                <p className="hidden text-sm text-[var(--text-secondary)] sm:block">
                  当前账号不可管理治理配置
                </p>
              )
            ) : tab === "rag" ? (
              <p className="hidden text-sm text-[var(--text-secondary)] sm:block">
                RAG 运行与记忆治理
              </p>
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
                if (tab === "rag") {
                  void loadRagView();
                  return;
                }
                if (actorRole === "admin") {
                  void loadWorkspaceOptions(true);
                  void loadRagView();
                }
                setManagementRefreshToken((previous) => previous + 1);
              }}
            >
              {refreshing || workspaceLoading || ragLoading ? "刷新中..." : "刷新"}
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
          ) : tab === "rag" ? (
            <div className="space-y-4">
              {ragLoading ? (
                <StateBlock variant="loading">正在加载 RAG 运行看板...</StateBlock>
              ) : null}
              {ragError ? <StateBlock variant="error">{ragError}</StateBlock> : null}

              <section className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Foundation 状态
                </h3>
                <RagFoundationStatusCard
                  foundation={foundationSnapshot}
                  loading={ragLoading}
                  error={ragFoundationError}
                />
              </section>

              <section className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  R2 Gate 报告
                </h3>
                {ragQuality ? (
                  <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                    <p>sampleSize: {ragQuality.sampleSize}</p>
                    <p>sampleReady: {ragQuality.sampleReady ? "true" : "false"}</p>
                    <p>gatePass: {ragQuality.gatePass ? "true" : "false"}</p>
                    <p>
                      reasons:{" "}
                      {ragQuality.reasons.length > 0
                        ? ragQuality.reasons.join(", ")
                        : "none"}
                    </p>
                  </div>
                ) : (
                  <StateBlock variant="idle">暂无 Gate 报告。</StateBlock>
                )}
              </section>

              <section className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  术语锚点治理
                </h3>
                {glossaryAnchorError ? (
                  <StateBlock variant="error">{glossaryAnchorError}</StateBlock>
                ) : null}
                <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                  <p>当前锚点：{activeGlossaryAnchorText}</p>
                  <p>最近回滚：{latestRollbackAnchorText}</p>
                </div>
              </section>

              <section className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  语义与回放概览
                </h3>
                {ragRunId ? (
                  <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <p>runId: {ragRunId}</p>
                      <Badge variant="outline">
                        来源：
                        {ragRunSource === "deep-link"
                          ? "deep-link runId"
                          : "latest run fallback"}
                      </Badge>
                    </div>
                    {ragRunSource === "deep-link" ? (
                      <p>latestRunId: {latestQualityRunId ?? "不可用（质量报告缺失）"}</p>
                    ) : null}
                    <p>语义版本：{semanticVersionText}</p>
                    <p>语义锁状态：{semanticLockStatusText}</p>
                    <p>语义降级原因：{semanticDegradeReasonText}</p>
                    <StateBlock variant={semanticDegradeTriggered ? "error" : "idle"}>
                      语义降级标识：
                      {semanticDegradeTriggered ? "已触发（不阻断主链路）" : "未触发"}
                    </StateBlock>
                    <p>技能上下文（只读）：{skillContextSummaryText}</p>
                    {ragReplay ? (
                      <p>
                        replay completeness: {Math.round(ragReplay.completeness * 100)}% · ready=
                        {ragReplay.ready ? "true" : "false"}
                      </p>
                    ) : (
                      <p>回放完整性：暂无数据。</p>
                    )}
                  </div>
                ) : (
                  <StateBlock variant="idle">暂无可用运行记录。</StateBlock>
                )}
              </section>

              {actorRole === "admin" ? (
                <section className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    记忆反馈（管理员）
                  </h3>
                  <Input
                    value={feedbackRunId}
                    onChange={(event) => setFeedbackRunId(event.target.value)}
                    placeholder="输入 runId"
                    aria-label="记忆反馈 runId"
                  />
                  <NativeSelect
                    value={feedbackStatus}
                    onChange={(event) =>
                      setFeedbackStatus(event.target.value as RagMemoryStatus)
                    }
                    aria-label="记忆反馈目标状态"
                  >
                    <NativeSelectOption value="candidate">candidate</NativeSelectOption>
                    <NativeSelectOption value="verified">verified</NativeSelectOption>
                    <NativeSelectOption value="production">production</NativeSelectOption>
                  </NativeSelect>
                  <Input
                    value={feedbackNote}
                    onChange={(event) => setFeedbackNote(event.target.value)}
                    placeholder="备注（可选）"
                    aria-label="记忆反馈备注"
                  />
                  <Button
                    onClick={() => {
                      void submitFeedback();
                    }}
                    disabled={!canSubmitFeedback || feedbackSubmitting}
                  >
                    {feedbackSubmitting ? "提交中..." : "提交记忆反馈"}
                  </Button>
                  {feedbackMessage ? (
                    <StateBlock
                      variant={feedbackMessage.includes("失败") ? "error" : "success"}
                    >
                      {feedbackMessage}
                    </StateBlock>
                  ) : null}
                </section>
              ) : (
                <section className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    记忆反馈（只读）
                  </h3>
                  <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                    <p>runId: {feedbackRunId || ragRunId || "暂无运行记录"}</p>
                    <p>目标状态（只读）：{feedbackStatus}</p>
                    <p>备注（只读）：{feedbackNote.trim() || "未填写"}</p>
                  </div>
                  <StateBlock variant="idle">
                    当前账号为只读视图，可查看记忆反馈上下文但不可提交。
                  </StateBlock>
                </section>
              )}
            </div>
          ) : tab === "users" ? (
            <div className="space-y-4">
              <section className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  术语锚点治理
                </h3>
                <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                  <p>当前锚点：{activeGlossaryAnchorText}</p>
                  <p>
                    最近回滚：
                    {latestRollbackResult
                      ? `${latestRollbackResult.activeAnchor.id}（replayed=${latestRollbackResult.replayed ? "true" : "false"}）`
                      : latestRollbackAnchorText}
                  </p>
                </div>
                {glossaryAnchorError ? (
                  <StateBlock variant="error">{glossaryAnchorError}</StateBlock>
                ) : null}

                {actorRole === "admin" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2 rounded-md border border-[var(--border-default)] bg-white/70 p-3">
                      <p className="text-xs font-medium text-[var(--text-secondary)]">
                        创建锚点（global）
                      </p>
                      <Input
                        value={anchorVersionInput}
                        onChange={(event) => setAnchorVersionInput(event.target.value)}
                        placeholder="版本号，例如 2"
                        aria-label="锚点版本号"
                      />
                      <Input
                        value={anchorSummaryInput}
                        onChange={(event) => setAnchorSummaryInput(event.target.value)}
                        placeholder="摘要（可选）"
                        aria-label="锚点摘要"
                      />
                      <Button
                        onClick={() => {
                          void submitCreateAnchor();
                        }}
                        disabled={anchorSubmitting}
                      >
                        {anchorSubmitting ? "创建中..." : "创建锚点"}
                      </Button>
                    </div>

                    <div className="space-y-2 rounded-md border border-[var(--border-default)] bg-white/70 p-3">
                      <p className="text-xs font-medium text-[var(--text-secondary)]">
                        执行回滚（global）
                      </p>
                      <NativeSelect
                        value={rollbackTargetAnchorId}
                        onChange={(event) => setRollbackTargetAnchorId(event.target.value)}
                        aria-label="回滚目标锚点"
                      >
                        <NativeSelectOption value="">请选择回滚目标锚点</NativeSelectOption>
                        {anchorCandidates.map((anchor) => (
                          <NativeSelectOption key={anchor.id} value={anchor.id}>
                            {`${anchor.id} · v${anchor.version} · ${anchor.anchorType}`}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Input
                        value={rollbackReasonInput}
                        onChange={(event) => setRollbackReasonInput(event.target.value)}
                        placeholder="回滚原因（可选）"
                        aria-label="回滚原因"
                      />
                      <Button
                        onClick={() => {
                          void submitRollbackAnchor();
                        }}
                        disabled={rollbackSubmitting}
                      >
                        {rollbackSubmitting ? "回滚中..." : "执行回滚"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <StateBlock variant="idle">
                    当前账号只读，可查看锚点状态，不可创建或回滚。
                  </StateBlock>
                )}

                {governanceActionMessage ? (
                  <StateBlock
                    variant={
                      governanceActionMessage.includes("无权限") ||
                      governanceActionMessage.includes("失败")
                        ? "error"
                        : "success"
                    }
                  >
                    {governanceActionMessage}
                  </StateBlock>
                ) : null}
              </section>

              <UsersManagementPanel
                actorRole={actorRole}
                workspaceScopeId={workspaceId}
                workspaceScopeName={selectedWorkspace?.name}
                refreshToken={managementRefreshToken}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <StateBlock variant="idle">
                在此维护工作空间、成员与数据源绑定关系。
              </StateBlock>
              {actorRole === "admin" ? (
                <div className="flex justify-end">
                  <Button asChild variant="outline">
                    <Link href="/settings/modeling">进入数据关系图</Link>
                  </Button>
                </div>
              ) : null}
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
