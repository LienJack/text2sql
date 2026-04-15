"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTableAcl,
  listWorkspaceDatasourceTables,
  replaceWorkspaceDatasourceTableAcl,
  type WorkspaceDatasourceBinding,
  type WorkspaceDatasourceTableAclRule
} from "@/lib/admin-api-client";

export interface ReplaceWorkspaceTableAclInput {
  subjectType: "role" | "user";
  subjectId: string;
  effect: "allow" | "deny";
  tableNames: string[];
}

export interface UseWorkspaceTableAclOptions {
  open: boolean;
  workspaceId: string;
  initialDatasourceId?: string;
}

export interface UseWorkspaceTableAclResult {
  bindings: WorkspaceDatasourceBinding[];
  datasourceId: string;
  rules: WorkspaceDatasourceTableAclRule[];
  tableOptions: string[];
  loading: boolean;
  loadingBindings: boolean;
  loadingRules: boolean;
  loadingTables: boolean;
  saving: boolean;
  error: string;
  setDatasourceId: (datasourceId: string) => void;
  clearError: () => void;
  replaceAcl: (input: ReplaceWorkspaceTableAclInput) => Promise<{
    addedTables: string[];
    removedTables: string[];
    retainedTables: string[];
  }>;
  reload: () => Promise<void>;
  reset: () => void;
}

function normalizeTableNames(items: string[]): string[] {
  const normalized = new Set<string>();
  for (const item of items) {
    const tableName = item.trim().toLowerCase();
    if (tableName) {
      normalized.add(tableName);
    }
  }
  return Array.from(normalized).sort((a, b) => a.localeCompare(b));
}

export function useWorkspaceTableAcl({
  open,
  workspaceId,
  initialDatasourceId
}: UseWorkspaceTableAclOptions): UseWorkspaceTableAclResult {
  const [bindings, setBindings] = useState<WorkspaceDatasourceBinding[]>([]);
  const [datasourceId, setDatasourceId] = useState("");
  const [rules, setRules] = useState<WorkspaceDatasourceTableAclRule[]>([]);
  const [tableOptions, setTableOptions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [saving, setSaving] = useState(false);

  const bindingsRequestRef = useRef(0);
  const detailsRequestRef = useRef(0);
  const inFlightSaveRef = useRef<Promise<{
    addedTables: string[];
    removedTables: string[];
    retainedTables: string[];
  }> | null>(null);

  const reset = useCallback(() => {
    bindingsRequestRef.current += 1;
    detailsRequestRef.current += 1;
    inFlightSaveRef.current = null;
    setBindings([]);
    setDatasourceId("");
    setRules([]);
    setTableOptions([]);
    setError("");
    setLoadingBindings(false);
    setLoadingRules(false);
    setLoadingTables(false);
    setSaving(false);
  }, []);

  const clearError = useCallback(() => {
    setError("");
  }, []);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      reset();
      return;
    }

    const requestId = ++bindingsRequestRef.current;
    setLoadingBindings(true);
    setError("");

    try {
      const items = await listWorkspaceDatasourceBindings(workspaceId);
      if (requestId !== bindingsRequestRef.current) {
        return;
      }

      setBindings(items);
      const preferredDatasourceId = initialDatasourceId?.trim();
      setDatasourceId((previous) => {
        if (previous && items.some((item) => item.datasourceId === previous)) {
          return previous;
        }
        if (
          preferredDatasourceId &&
          items.some((item) => item.datasourceId === preferredDatasourceId)
        ) {
          return preferredDatasourceId;
        }
        return items[0]?.datasourceId ?? "";
      });
    } catch (loadError) {
      if (requestId === bindingsRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "加载绑定数据源失败");
      }
    } finally {
      if (requestId === bindingsRequestRef.current) {
        setLoadingBindings(false);
      }
    }
  }, [initialDatasourceId, reset, workspaceId]);

  const reloadDatasourceDetails = useCallback(async () => {
    if (!workspaceId || !datasourceId) {
      setRules([]);
      setTableOptions([]);
      return;
    }

    const requestId = ++detailsRequestRef.current;
    setLoadingRules(true);
    setLoadingTables(true);

    try {
      const [nextRules, nextTables] = await Promise.all([
        listWorkspaceDatasourceTableAcl(workspaceId, datasourceId),
        listWorkspaceDatasourceTables(workspaceId, datasourceId)
      ]);

      if (requestId !== detailsRequestRef.current) {
        return;
      }

      setRules(nextRules);
      setTableOptions(normalizeTableNames(nextTables));
    } catch (loadError) {
      if (requestId === detailsRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "加载表权限失败");
      }
    } finally {
      if (requestId === detailsRequestRef.current) {
        setLoadingRules(false);
        setLoadingTables(false);
      }
    }
  }, [datasourceId, workspaceId]);

  const replaceAcl = useCallback(
    async (input: ReplaceWorkspaceTableAclInput) => {
      if (!workspaceId || !datasourceId) {
        throw new Error("请先选择工作空间和数据源");
      }

      if (inFlightSaveRef.current) {
        return inFlightSaveRef.current;
      }

      const task = (async () => {
        setSaving(true);
        setError("");

        try {
          const result = await replaceWorkspaceDatasourceTableAcl({
            workspaceId,
            datasourceId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            effect: input.effect,
            tableNames: input.tableNames
          });
          await reloadDatasourceDetails();
          return result;
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : "保存表权限失败");
          throw saveError;
        } finally {
          setSaving(false);
        }
      })();

      inFlightSaveRef.current = task;
      task.finally(() => {
        if (inFlightSaveRef.current === task) {
          inFlightSaveRef.current = null;
        }
      });

      return task;
    },
    [datasourceId, reloadDatasourceDetails, workspaceId]
  );

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    void reload();
  }, [open, reload, reset]);

  useEffect(() => {
    if (!open || !workspaceId || !datasourceId) {
      setRules([]);
      setTableOptions([]);
      return;
    }
    void reloadDatasourceDetails();
  }, [datasourceId, open, reloadDatasourceDetails, workspaceId]);

  const loading = useMemo(
    () => loadingBindings || loadingRules || loadingTables,
    [loadingBindings, loadingRules, loadingTables]
  );

  return {
    bindings,
    datasourceId,
    rules,
    tableOptions,
    loading,
    loadingBindings,
    loadingRules,
    loadingTables,
    saving,
    error,
    setDatasourceId,
    clearError,
    replaceAcl,
    reload,
    reset
  };
}
