"use client";

import { useEffect, useMemo, useState } from "react";
import type { Datasource } from "@text2sql/shared-types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { listDatasources } from "@/lib/api-client";
import {
  addWorkspaceDatasourceBindings,
  listWorkspaceDatasourceBindings,
  removeWorkspaceDatasourceBindings
} from "@/lib/admin-api-client";

interface WorkspaceDatasourceBindingDialogProps {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceDatasourceBindingDialog({
  open,
  workspaceId,
  workspaceName,
  onOpenChange
}: WorkspaceDatasourceBindingDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [initialIds, setInitialIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !workspaceId) {
      return;
    }
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [all, bindings] = await Promise.all([
          listDatasources({
            includeUnavailable: true,
            ignoreWorkspaceScope: true
          }),
          listWorkspaceDatasourceBindings(workspaceId)
        ]);
        if (!mounted) {
          return;
        }
        const boundIds = bindings.map((item) => item.datasourceId);
        setDatasources(all);
        setSelectedIds(boundIds);
        setInitialIds(boundIds);
      } catch (loadError) {
        if (!mounted) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载绑定数据失败");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [open, workspaceId]);

  const hasChanges = useMemo(() => {
    const current = [...selectedIds].sort();
    const initial = [...initialIds].sort();
    return current.join(",") !== initial.join(",");
  }, [initialIds, selectedIds]);

  const toggleSelection = (datasourceId: string): void => {
    setSelectedIds((prev) =>
      prev.includes(datasourceId)
        ? prev.filter((item) => item !== datasourceId)
        : [...prev, datasourceId]
    );
  };

  const submit = async (): Promise<void> => {
    if (!workspaceId || !hasChanges) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const toAdd = selectedIds.filter((id) => !initialIds.includes(id));
      const toRemove = initialIds.filter((id) => !selectedIds.includes(id));
      if (toAdd.length > 0) {
        await addWorkspaceDatasourceBindings(workspaceId, toAdd);
      }
      if (toRemove.length > 0) {
        await removeWorkspaceDatasourceBindings(workspaceId, toRemove);
      }
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存绑定失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>数据源绑定</DialogTitle>
          <DialogDescription>
            为工作空间「{workspaceName}」选择可用数据源。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <StateBlock variant="loading">正在加载数据源...</StateBlock>
        ) : (
          <div className="max-h-[360px] space-y-3 overflow-auto pr-1">
            {datasources.map((datasource) => (
              <label
                key={datasource.id}
                className="flex items-start gap-3 rounded-lg border border-[var(--border-default)] px-3 py-2"
              >
                <Checkbox
                  checked={selectedIds.includes(datasource.id)}
                  onCheckedChange={() => toggleSelection(datasource.id)}
                />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{datasource.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {datasource.id} · {datasource.type} · {datasource.status}
                  </p>
                </div>
              </label>
            ))}
            {datasources.length === 0 && (
              <StateBlock variant="idle">暂无可绑定的数据源。</StateBlock>
            )}
          </div>
        )}

        {error ? <StateBlock variant="error">{error}</StateBlock> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={saving || loading}>
            {saving ? "保存中..." : "保存绑定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
