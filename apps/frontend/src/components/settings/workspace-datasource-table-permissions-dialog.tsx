"use client";

import { Database, ShieldCheck, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { WorkspaceDatasourceTablePermissionsPanel } from "./workspace-datasource-table-permissions-panel";

interface WorkspaceDatasourceTablePermissionsDialogProps {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  datasourceId: string;
  datasourceName: string;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceDatasourceTablePermissionsDialog({
  open,
  workspaceId,
  workspaceName,
  datasourceId,
  datasourceName,
  onOpenChange
}: WorkspaceDatasourceTablePermissionsDialogProps) {
  const missingContext = !workspaceId || !datasourceId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-[var(--border-default)] bg-[linear-gradient(120deg,rgba(37,99,235,0.08),rgba(148,197,251,0.06),rgba(255,255,255,0.88))] px-5 pt-5 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-brand)] bg-[var(--surface-active)] text-[var(--action-primary)] shadow-[0_1px_2px_rgba(37,99,235,0.18)]">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <DialogTitle>表权限编辑</DialogTitle>
              </div>
              <DialogDescription>
                工作空间「{workspaceName}」· 数据源「{datasourceName}」
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-1.5 text-xs text-[var(--text-secondary)] shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                <Database className="h-3.5 w-3.5 text-[var(--action-primary)]" />
                空间级共享策略
              </div>
              <DialogClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="关闭表权限编辑">
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto bg-[var(--surface-subtle)] p-4 sm:p-5">
          {missingContext ? (
            <StateBlock variant="idle">缺少工作空间或数据源上下文，暂不可编辑表权限。</StateBlock>
          ) : (
            <WorkspaceDatasourceTablePermissionsPanel
              actorRole="admin"
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              fixedDatasourceId={datasourceId}
              fixedDatasourceName={datasourceName}
              hideDatasourceSelector
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
