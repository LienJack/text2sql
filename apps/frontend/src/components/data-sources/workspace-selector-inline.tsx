"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import type { WorkspaceSummary } from "@/lib/admin-api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import { WorkspaceEditorDialog } from "@/components/settings/workspace-editor-dialog";

interface WorkspaceSelectorInlineProps {
  workspaceId: string;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  disabled?: boolean;
  error?: string;
  onWorkspaceIdChange: (workspaceId: string) => void;
  onWorkspaceCreated: (workspace: WorkspaceSummary) => void;
  onCreateWorkspace: (name: string) => Promise<WorkspaceSummary>;
}

export function WorkspaceSelectorInline({
  workspaceId,
  workspaces,
  loading,
  disabled,
  error,
  onWorkspaceIdChange,
  onWorkspaceCreated,
  onCreateWorkspace
}: WorkspaceSelectorInlineProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-subtle)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-sm font-medium text-[var(--text-primary)]">工作空间</Label>
          <p className="text-xs text-[var(--text-tertiary)]">
            ACL 授权必须绑定到一个工作空间。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          新建工作空间
        </Button>
      </div>

      {loading ? (
        <StateBlock variant="loading">正在加载工作空间...</StateBlock>
      ) : (
        <NativeSelect
          value={workspaceId}
          disabled={disabled || workspaces.length === 0}
          onChange={(event) => onWorkspaceIdChange(event.target.value)}
        >
          <NativeSelectOption value="">请选择工作空间</NativeSelectOption>
          {workspaces.map((workspace) => (
            <NativeSelectOption key={workspace.id} value={workspace.id}>
              {workspace.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}

      {error ? <StateBlock variant="error">{error}</StateBlock> : null}

      <WorkspaceEditorDialog
        open={createDialogOpen}
        mode="create"
        loading={creatingWorkspace}
        onOpenChange={setCreateDialogOpen}
        onSubmit={async (name) => {
          setCreatingWorkspace(true);
          try {
            const created = await onCreateWorkspace(name);
            onWorkspaceCreated(created);
          } finally {
            setCreatingWorkspace(false);
          }
        }}
      />
    </div>
  );
}

