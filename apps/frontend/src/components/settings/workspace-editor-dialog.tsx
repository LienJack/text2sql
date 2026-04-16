"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StateBlock } from "@/components/ui/state-block";

interface WorkspaceEditorDialogProps {
  open: boolean;
  mode: "create" | "rename";
  loading?: boolean;
  initialName?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}

export function WorkspaceEditorDialog({
  open,
  mode,
  loading,
  initialName,
  onOpenChange,
  onSubmit
}: WorkspaceEditorDialogProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setError("");
    setName(initialName ?? "");
  }, [initialName, open]);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("请输入工作空间名称。");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存工作空间失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新建工作空间" : "重命名工作空间"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "创建后可在右侧成员列表中添加管理员与成员。"
              : "修改名称后将即时同步到空间列表。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="workspace-editor-name">工作空间名称</Label>
          <Input
            id="workspace-editor-name"
            value={name}
            disabled={loading || submitting}
            placeholder="例如：增长分析"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        {error ? <StateBlock variant="error">{error}</StateBlock> : null}

        <DialogFooter>
          <Button variant="outline" disabled={loading || submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={loading || submitting} onClick={() => void submit()}>
            {submitting ? "保存中..." : mode === "create" ? "创建" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
