"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import {
  saveModelingViewFromRun,
  type SaveModelingViewFromRunResult
} from "@/lib/admin-api-client";

export interface SaveAsViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  datasourceId: string;
  runId: string;
  onSaved?: (result: SaveModelingViewFromRunResult) => void;
}

function buildDefaultName(runId: string): string {
  if (!runId) {
    return "";
  }
  const suffix = runId.replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 18);
  return `chat_view_${suffix}`;
}

export function SaveAsViewDialog({
  open,
  onOpenChange,
  workspaceId,
  datasourceId,
  runId,
  onSaved
}: SaveAsViewDialogProps) {
  const suggestedName = useMemo(() => buildDefaultName(runId), [runId]);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<SaveModelingViewFromRunResult | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError("");
    setSuccess(null);
    setName((previous) => previous || suggestedName);
    setDisplayName((previous) => previous || suggestedName);
  }, [open, suggestedName]);

  const submit = async (): Promise<void> => {
    if (!workspaceId || !datasourceId || !runId) {
      setError("缺少 workspace/datasource/runId，上下文不可保存。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await saveModelingViewFromRun(workspaceId, datasourceId, {
        runId,
        name,
        displayName,
        description
      });
      setSuccess(result);
      onSaved?.(result);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  const goToModeling = (): void => {
    if (!success || typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem("text2sql.activeWorkspaceId", success.workspaceId);
    window.sessionStorage.setItem("text2sql.activeDatasourceId", success.datasourceId);
    window.sessionStorage.setItem("text2sql.modeling.selectViewId", success.view.id);
    window.location.assign(
      `/settings/modeling?workspaceId=${encodeURIComponent(
        success.workspaceId
      )}&datasourceId=${encodeURIComponent(success.datasourceId)}&viewId=${encodeURIComponent(
        success.view.id
      )}`
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Save as View</DialogTitle>
          <DialogDescription>
            将当前 chat run 产出的 SQL 保存为 Modeling View，保存后状态为 undeployed。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="save-view-name">View 名称</Label>
            <Input
              id="save-view-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 orders_recent_summary"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="save-view-display-name">显示名称</Label>
            <Input
              id="save-view-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="例如 Recent Orders Summary"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="save-view-description">描述（可选）</Label>
            <Textarea
              id="save-view-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="填写业务语义，便于建模资产管理"
              disabled={saving}
            />
          </div>
          {error ? <StateBlock variant="error">{error}</StateBlock> : null}
          {success ? (
            <StateBlock variant="success">
              保存成功：{success.view.name}（draft revision {success.draftRevision}
              ）
            </StateBlock>
          ) : null}
        </div>

        <DialogFooter>
          {success ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                稍后处理
              </Button>
              <Button type="button" onClick={goToModeling}>
                前往 Modeling
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                取消
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={saving}>
                {saving ? "保存中..." : "保存为 View"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
