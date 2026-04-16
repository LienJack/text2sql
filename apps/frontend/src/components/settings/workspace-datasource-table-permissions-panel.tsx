"use client";

import { RefreshCcw, Save, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import {
  AdminApiError,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaceDatasourceTables,
  replaceWorkspaceDatasourceTablePermissions
} from "@/lib/admin-api-client";

interface WorkspaceDatasourceTablePermissionsPanelProps {
  actorRole: "admin" | "user";
  workspaceId: string;
  workspaceName?: string;
  fixedDatasourceId?: string;
  fixedDatasourceName?: string;
  hideDatasourceSelector?: boolean;
  refreshToken?: number;
}

type FeedbackState = {
  type: "success" | "error";
  text: string;
};

type ConflictState = {
  message: string;
  policyVersion?: number;
  serverSummary?: string;
};

type SnapshotState = {
  tableNames: string[];
  policyVersion: number;
};

function normalizeTableNames(items: string[]): string[] {
  const deduped = new Set<string>();
  for (const item of items) {
    const normalized = item.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped).sort((left, right) => left.localeCompare(right));
}

function createIdempotencyKey(prefix = "workspace-table-permissions"): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`请求超时（>${Math.ceil(timeoutMs / 1000)}s），请重试。`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConflictError(error: AdminApiError): boolean {
  if ((error.code ?? "").toUpperCase().includes("CONFLICT")) {
    return true;
  }
  if (isRecord(error.details)) {
    const statusCode = error.details.statusCode;
    if (statusCode === 409 || statusCode === "409") {
      return true;
    }
    const detailsCode = String(error.details.code ?? "").toUpperCase();
    return detailsCode.includes("CONFLICT");
  }
  return false;
}

function resolveConflictPolicyVersion(details: unknown): number | undefined {
  if (!isRecord(details)) {
    return undefined;
  }
  const candidates = [
    details.policyVersion,
    details.latestPolicyVersion,
    details.serverPolicyVersion,
    details.version,
    details.etag
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.max(0, Math.floor(candidate));
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.floor(parsed));
      }
    }
  }
  return undefined;
}

function readNumberCandidate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return undefined;
}

function resolveConflictSummary(details: unknown): string | undefined {
  if (!isRecord(details)) {
    return undefined;
  }
  const afterCount = readNumberCandidate(
    details.afterCount ?? details.serverAfterCount ?? details.currentCount
  );
  const addedCount = readNumberCandidate(
    details.addedCount ?? details.serverAddedCount ?? details.deltaAdded
  );
  const removedCount = readNumberCandidate(
    details.removedCount ?? details.serverRemovedCount ?? details.deltaRemoved
  );

  const summaryParts: string[] = [];
  if (afterCount !== undefined) {
    summaryParts.push(`服务端当前授权 ${afterCount} 张表`);
  }
  if (addedCount !== undefined || removedCount !== undefined) {
    summaryParts.push(`最近变更：新增 ${addedCount ?? 0}，移除 ${removedCount ?? 0}`);
  }

  if (summaryParts.length === 0) {
    return undefined;
  }
  return summaryParts.join("；");
}

function setsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function WorkspaceDatasourceTablePermissionsPanel({
  actorRole,
  workspaceId,
  workspaceName,
  fixedDatasourceId,
  fixedDatasourceName,
  hideDatasourceSelector = false,
  refreshToken = 0
}: WorkspaceDatasourceTablePermissionsPanelProps) {
  const [loadingDatasources, setLoadingDatasources] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [saving, setSaving] = useState(false);

  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [liveMessage, setLiveMessage] = useState("");

  const [datasourceOptions, setDatasourceOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [datasourceId, setDatasourceId] = useState("");
  const [tableKeyword, setTableKeyword] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [policyVersion, setPolicyVersion] = useState(0);
  const [serverSelectedTables, setServerSelectedTables] = useState<string[]>([]);
  const [draftSelectedTables, setDraftSelectedTables] = useState<string[]>([]);
  const [rollbackSnapshot, setRollbackSnapshot] = useState<SnapshotState | null>(null);
  const snapshotRequestSeqRef = useRef(0);
  const saveIntentKeyRef = useRef<string | null>(null);

  const loadDatasourceOptions = useCallback(async (): Promise<void> => {
    if (!workspaceId || actorRole !== "admin") {
      setLoadingDatasources(false);
      setDatasourceOptions([]);
      setDatasourceId("");
      return;
    }

    const normalizedFixedDatasourceId = fixedDatasourceId?.trim() ?? "";
    if (normalizedFixedDatasourceId) {
      const name = fixedDatasourceName?.trim() || normalizedFixedDatasourceId;
      setLoadingDatasources(false);
      setDatasourceOptions([{ id: normalizedFixedDatasourceId, name }]);
      setDatasourceId(normalizedFixedDatasourceId);
      return;
    }

    setLoadingDatasources(true);
    try {
      const items = await listWorkspaceDatasourceBindings(workspaceId);
      const options = items
        .map((item) => ({
          id: item.datasourceId,
          name: item.datasourceName?.trim() || item.datasourceId
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
      setDatasourceOptions(options);
      setDatasourceId((previous) => {
        if (previous && options.some((item) => item.id === previous)) {
          return previous;
        }
        return options[0]?.id ?? "";
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "加载工作空间数据源失败。"
      });
      setDatasourceOptions([]);
      setDatasourceId("");
    } finally {
      setLoadingDatasources(false);
    }
  }, [actorRole, fixedDatasourceId, fixedDatasourceName, workspaceId]);

  const loadSnapshot = useCallback(
    async (options?: { preserveDraft?: boolean }): Promise<void> => {
      const requestSeq = snapshotRequestSeqRef.current + 1;
      snapshotRequestSeqRef.current = requestSeq;
      if (!workspaceId || !datasourceId || actorRole !== "admin") {
        setTables([]);
        setPolicyVersion(0);
        setServerSelectedTables([]);
        setDraftSelectedTables([]);
        saveIntentKeyRef.current = null;
        return;
      }

      const preserveDraft = options?.preserveDraft === true;
      setLoadingSnapshot(true);
      try {
        const [tableList, permissionSnapshot] = await Promise.all([
          listWorkspaceDatasourceTables(workspaceId, datasourceId),
          listWorkspaceDatasourceTablePermissions(workspaceId, datasourceId)
        ]);
        if (requestSeq !== snapshotRequestSeqRef.current) {
          return;
        }
        const normalizedTables = normalizeTableNames(tableList);
        const tableSet = new Set(normalizedTables);
        const normalizedServerSelected = normalizeTableNames(
          permissionSnapshot.tableNames.filter((tableName) => tableSet.has(tableName))
        );

        setTables(normalizedTables);
        setPolicyVersion(permissionSnapshot.policyVersion);
        setServerSelectedTables(normalizedServerSelected);
        setDraftSelectedTables((previous) => {
          if (!preserveDraft) {
            return normalizedServerSelected;
          }
          return normalizeTableNames(previous.filter((tableName) => tableSet.has(tableName)));
        });
        if (!preserveDraft) {
          setRollbackSnapshot(null);
        }
        saveIntentKeyRef.current = null;
        setConflict(null);
      } catch (error) {
        if (requestSeq !== snapshotRequestSeqRef.current) {
          return;
        }
        setFeedback({
          type: "error",
          text: error instanceof Error ? error.message : "加载表权限快照失败。"
        });
      } finally {
        if (requestSeq === snapshotRequestSeqRef.current) {
          setLoadingSnapshot(false);
        }
      }
    },
    [actorRole, datasourceId, workspaceId]
  );

  useEffect(() => {
    void loadDatasourceOptions();
  }, [loadDatasourceOptions, refreshToken]);

  useEffect(() => {
    setTableKeyword("");
  }, [datasourceId, workspaceId]);

  useEffect(() => {
    setRollbackSnapshot(null);
    saveIntentKeyRef.current = null;
  }, [workspaceId, datasourceId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot, refreshToken]);

  const filteredTables = useMemo(() => {
    const keyword = tableKeyword.trim().toLowerCase();
    if (!keyword) {
      return tables;
    }
    return tables.filter((tableName) => tableName.includes(keyword));
  }, [tableKeyword, tables]);

  const draftSelectedSet = useMemo(
    () => new Set(draftSelectedTables),
    [draftSelectedTables]
  );
  const activeDatasourceName = useMemo(() => {
    if (fixedDatasourceName?.trim()) {
      return fixedDatasourceName.trim();
    }
    return datasourceOptions.find((item) => item.id === datasourceId)?.name ?? datasourceId;
  }, [datasourceId, datasourceOptions, fixedDatasourceName]);
  const selectedCount = draftSelectedTables.length;
  const filteredCount = filteredTables.length;
  const totalCount = tables.length;
  const selectedFilteredCount = filteredTables.reduce(
    (count, tableName) => (draftSelectedSet.has(tableName) ? count + 1 : count),
    0
  );

  const addedCount = useMemo(() => {
    const baseline = new Set(serverSelectedTables);
    return draftSelectedTables.reduce(
      (count, tableName) => (baseline.has(tableName) ? count : count + 1),
      0
    );
  }, [draftSelectedTables, serverSelectedTables]);

  const removedCount = useMemo(() => {
    const draftSet = new Set(draftSelectedTables);
    return serverSelectedTables.reduce(
      (count, tableName) => (draftSet.has(tableName) ? count : count + 1),
      0
    );
  }, [draftSelectedTables, serverSelectedTables]);

  const hasDraftChanges = useMemo(() => {
    return !setsEqual(draftSelectedTables, serverSelectedTables);
  }, [draftSelectedTables, serverSelectedTables]);

  const toggleTable = (tableName: string): void => {
    saveIntentKeyRef.current = null;
    setDraftSelectedTables((previous) => {
      if (previous.includes(tableName)) {
        return previous.filter((item) => item !== tableName);
      }
      return normalizeTableNames([...previous, tableName]);
    });
  };

  const selectFilteredTables = (): void => {
    saveIntentKeyRef.current = null;
    setDraftSelectedTables((previous) => normalizeTableNames([...previous, ...filteredTables]));
  };

  const unselectFilteredTables = (): void => {
    const filteredSet = new Set(filteredTables);
    saveIntentKeyRef.current = null;
    setDraftSelectedTables((previous) => previous.filter((item) => !filteredSet.has(item)));
  };

  const submit = async (options?: {
    overridePolicyVersion?: number;
    tableNames?: string[];
    successPrefix?: string;
    ignoreDraftChange?: boolean;
  }): Promise<void> => {
    if (!workspaceId || !datasourceId) {
      return;
    }
    const nextTableNames = normalizeTableNames(options?.tableNames ?? draftSelectedTables);
    const ignoreDraftChange = options?.ignoreDraftChange === true;
    if (!ignoreDraftChange && !hasDraftChanges) {
      return;
    }
    if (ignoreDraftChange && setsEqual(nextTableNames, serverSelectedTables)) {
      return;
    }

    setSaving(true);
    setFeedback(null);

    const shouldReuseIdempotencyKey = options?.overridePolicyVersion === undefined;
    const idempotencyKey = shouldReuseIdempotencyKey
      ? (saveIntentKeyRef.current ?? createIdempotencyKey())
      : createIdempotencyKey();
    if (shouldReuseIdempotencyKey) {
      saveIntentKeyRef.current = idempotencyKey;
    } else {
      saveIntentKeyRef.current = null;
    }

    try {
      const baselineSnapshot: SnapshotState = {
        tableNames: [...serverSelectedTables],
        policyVersion
      };
      const response = await withTimeout(
        replaceWorkspaceDatasourceTablePermissions(workspaceId, datasourceId, {
          tableNames: nextTableNames,
          policyVersion: options?.overridePolicyVersion ?? policyVersion,
          idempotencyKey
        }),
        15000
      );
      const normalizedSaved = normalizeTableNames(response.tableNames);
      const nextPolicyVersion =
        response.policyVersion ?? options?.overridePolicyVersion ?? policyVersion;

      setServerSelectedTables(normalizedSaved);
      setDraftSelectedTables(normalizedSaved);
      setPolicyVersion(nextPolicyVersion);
      setRollbackSnapshot(baselineSnapshot);
      setConflict(null);
      saveIntentKeyRef.current = null;

      const summary = `${options?.successPrefix ?? "已保存并作用于工作空间全部成员。"}当前授权 ${
        response.afterCount
      } 张表，较上次减少 ${response.removedCount} 张。`;
      setFeedback({
        type: "success",
        text: summary
      });
      setLiveMessage(summary);
    } catch (error) {
      if (error instanceof AdminApiError && isConflictError(error)) {
        const latestPolicyVersion = resolveConflictPolicyVersion(error.details);
        const conflictSummary = resolveConflictSummary(error.details);
        setConflict({
          message: error.message || "检测到并发更新，请刷新后重试。",
          policyVersion: latestPolicyVersion,
          serverSummary: conflictSummary
        });
        setFeedback({
          type: "error",
          text: "保存冲突：已保留本地草稿，可刷新服务端快照后重试。"
        });
        setLiveMessage("保存发生冲突，本地草稿已保留。");
        saveIntentKeyRef.current = null;
      } else {
        setFeedback({
          type: "error",
          text: error instanceof Error ? error.message : "保存表权限失败，请重试。"
        });
        setLiveMessage("保存失败，请重试。");
        if (!shouldReuseIdempotencyKey) {
          saveIntentKeyRef.current = null;
        }
      }
    } finally {
      setSaving(false);
    }
  };

  if (actorRole !== "admin") {
    return <StateBlock variant="idle">当前账号不可管理工作空间表权限。</StateBlock>;
  }

  if (!workspaceId) {
    return <StateBlock variant="idle">请先选择工作空间后再配置表权限。</StateBlock>;
  }

  return (
    <section className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="animate-in fade-in-0 zoom-in-95 space-y-4 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] duration-200">
            <div className="flex flex-wrap items-center gap-2">
              {hideDatasourceSelector ? (
                <Badge variant="secondary">数据源：{activeDatasourceName || "--"}</Badge>
              ) : (
                <div className="min-w-[220px] flex-1">
                  <NativeSelect
                    value={datasourceId}
                    disabled={loadingDatasources || datasourceOptions.length === 0 || saving}
                    onChange={(event) => {
                      setDatasourceId(event.target.value);
                      setFeedback(null);
                      setConflict(null);
                    }}
                    aria-label="选择数据源"
                  >
                    <NativeSelectOption value="">请选择数据源</NativeSelectOption>
                    {datasourceOptions.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {item.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              )}
              {workspaceName ? <Badge variant="secondary">工作空间：{workspaceName}</Badge> : null}
              <Badge variant={hasDraftChanges ? "outline" : "secondary"}>
                {hasDraftChanges ? "草稿未保存" : "已与服务端同步"}
              </Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                disabled={loadingDatasources || loadingSnapshot || saving}
                onClick={() => {
                  if (!hideDatasourceSelector) {
                    void loadDatasourceOptions();
                  }
                  void loadSnapshot({ preserveDraft: true });
                }}
              >
                <RefreshCcw className="h-4 w-4" />
                刷新
              </Button>
              <Button
                disabled={saving || loadingSnapshot || !datasourceId || !hasDraftChanges}
                onClick={() => {
                  void submit();
                }}
              >
                <Save className="h-4 w-4" />
                {saving ? "保存中..." : "保存权限"}
              </Button>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
              <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-3">
                <Badge variant="secondary">已选 {selectedCount}</Badge>
                <Badge variant="secondary">筛选 {selectedFilteredCount}/{filteredCount}</Badge>
                <Badge variant="secondary">总表 {totalCount}</Badge>
              </div>
              <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                批量操作仅作用于当前筛选结果。
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
              <Input
                value={tableKeyword}
                onChange={(event) => setTableKeyword(event.target.value)}
                className="pl-9"
                placeholder="搜索表名"
                disabled={loadingSnapshot || saving || totalCount === 0}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                disabled={filteredCount === 0 || loadingSnapshot || saving}
                onClick={selectFilteredTables}
              >
                全选筛选结果（{filteredCount}）
              </Button>
              <Button
                variant="outline"
                disabled={selectedFilteredCount === 0 || loadingSnapshot || saving}
                onClick={unselectFilteredTables}
              >
                取消筛选已选（{selectedFilteredCount}）
              </Button>
            </div>
          </div>

          {hasDraftChanges ? (
            <StateBlock variant="idle">
              待保存变更：新增 {addedCount} 张，移除 {removedCount} 张。
            </StateBlock>
          ) : (
            <StateBlock variant="idle">当前草稿与服务端一致，无需保存。</StateBlock>
          )}

          {feedback ? <StateBlock variant={feedback.type}>{feedback.text}</StateBlock> : null}
          {feedback?.type === "error" && !conflict ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
              <p className="text-sm text-[var(--text-secondary)]">可直接重试当前草稿保存。</p>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || loadingSnapshot || !datasourceId || !hasDraftChanges}
                onClick={() => {
                  void submit();
                }}
              >
                重试保存
              </Button>
            </div>
          ) : null}

          {conflict ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{conflict.message}</p>
              {conflict.serverSummary ? (
                <p className="w-full text-xs text-destructive/90">{conflict.serverSummary}</p>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  void submit({ overridePolicyVersion: conflict.policyVersion });
                }}
              >
                重试保存
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || loadingSnapshot}
                onClick={() => {
                  void loadSnapshot({ preserveDraft: true });
                }}
              >
                刷新服务端
              </Button>
            </div>
          ) : null}

          {feedback?.type === "success" && rollbackSnapshot ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
              <p className="text-sm text-[var(--text-secondary)]">
                误操作可一键恢复到上一版本快照（{rollbackSnapshot.tableNames.length} 张表）。
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || loadingSnapshot || !datasourceId}
                onClick={() => {
                  void submit({
                    tableNames: rollbackSnapshot.tableNames,
                    successPrefix: "已恢复到上一版本快照并作用于工作空间全部成员。",
                    ignoreDraftChange: true
                  });
                }}
              >
                恢复上一次版本
              </Button>
            </div>
          ) : null}

          {datasourceOptions.length === 0 && !loadingDatasources ? (
            <StateBlock variant="idle">
              当前工作空间未绑定数据源，请先在工作空间管理中完成绑定。
            </StateBlock>
          ) : null}
        </aside>

        <section className="min-h-[420px] overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-panel)] shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-subtle)] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">授权表清单</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                当前筛选范围 {filteredCount} 张表
              </p>
            </div>
            <Badge variant="secondary">已授权 {selectedCount}/{totalCount}</Badge>
          </div>

          {loadingSnapshot ? (
            <div className="p-4">
              <StateBlock variant="loading">正在加载表清单与权限快照...</StateBlock>
            </div>
          ) : null}

          {!loadingSnapshot && datasourceId && tables.length === 0 ? (
            <div className="p-4">
              <StateBlock variant="idle">所选数据源暂无可授权的数据表。</StateBlock>
            </div>
          ) : null}

          {!loadingSnapshot && datasourceId && tables.length > 0 ? (
            <div className="max-h-[58vh] space-y-2 overflow-auto p-3">
              {filteredTables.length === 0 ? (
                <StateBlock variant="idle">当前筛选条件下无匹配表，请调整关键词。</StateBlock>
              ) : (
                filteredTables.map((tableName) => {
                  const checked = draftSelectedSet.has(tableName);
                  return (
                    <label
                      key={tableName}
                      className={`group flex items-center gap-3 rounded-lg border px-3 py-2 transition-all duration-200 ${
                        checked
                          ? "border-[var(--border-brand)] bg-[var(--surface-active)]/70 shadow-[0_2px_8px_rgba(37,99,235,0.12)]"
                          : "border-[var(--border-default)] hover:border-[var(--border-brand)] hover:bg-[var(--surface-subtle)]"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleTable(tableName)}
                        disabled={saving}
                      />
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="truncate font-mono text-sm tracking-wide">{tableName}</span>
                        <span
                          aria-hidden="true"
                          className={`text-[11px] font-medium ${
                            checked ? "text-[var(--action-primary)]" : "text-[var(--text-tertiary)]"
                          }`}
                        >
                          {checked ? "已授权" : "未授权"}
                        </span>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
