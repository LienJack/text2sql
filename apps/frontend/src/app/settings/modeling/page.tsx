"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getWorkspaceRelationshipDraft,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces,
  precheckWorkspaceRelationshipPublish,
  publishWorkspaceRelationshipDraft,
  replaceWorkspaceRelationshipDraft,
  rollbackWorkspaceRelationshipDraft,
  type WorkspaceRelationshipDraft,
  type WorkspaceRelationshipEdge,
  type WorkspaceRelationshipPublishPrecheck
} from "@/lib/admin-api-client";
import {
  readActiveDatasourceId,
  readActiveWorkspaceId,
  writeActiveDatasourceId,
  writeActiveWorkspaceId
} from "@/lib/datasource-session-context";
import { RelationshipEdgeEditorDialog } from "@/components/settings/relationship-edge-editor-dialog";
import { RelationshipModelingCanvas } from "@/components/settings/relationship-modeling-canvas";
import { RelationshipPublishPanel } from "@/components/settings/relationship-publish-panel";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";

function readModelingPageQueryContext(): {
  workspaceIdFromQuery: string;
  datasourceIdFromQuery: string;
} {
  if (typeof window === "undefined") {
    return {
      workspaceIdFromQuery: "",
      datasourceIdFromQuery: ""
    };
  }
  const searchParams = new URLSearchParams(window.location.search);
  return {
    workspaceIdFromQuery: searchParams.get("workspaceId")?.trim() ?? "",
    datasourceIdFromQuery:
      searchParams.get("datasourceId")?.trim() ??
      searchParams.get("datasource")?.trim() ??
      ""
  };
}

export default function RelationshipModelingPage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [datasourceId, setDatasourceId] = useState("");
  const [policyVersion, setPolicyVersion] = useState(0);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [datasources, setDatasources] = useState<Array<{ id: string; name: string }>>([]);
  const [edges, setEdges] = useState<WorkspaceRelationshipEdge[]>([]);
  const [draft, setDraft] = useState<WorkspaceRelationshipDraft | null>(null);
  const [activeRevision, setActiveRevision] = useState<number | undefined>(undefined);
  const [precheck, setPrecheck] = useState<WorkspaceRelationshipPublishPrecheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEdge, setEditingEdge] = useState<WorkspaceRelationshipEdge | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      setBusy(true);
      try {
        const workspaceResult = await listWorkspaces({ page: 1, pageSize: 200 });
        const nextWorkspaces = workspaceResult.items.map((item) => ({
          id: item.id,
          name: item.name
        }));
        setWorkspaces(nextWorkspaces);
        const { workspaceIdFromQuery } = readModelingPageQueryContext();
        const preferredWorkspaceId = workspaceIdFromQuery || readActiveWorkspaceId();
        const resolvedWorkspaceId =
          (preferredWorkspaceId &&
            nextWorkspaces.find((item) => item.id === preferredWorkspaceId)?.id) ||
          nextWorkspaces[0]?.id ||
          "";
        setWorkspaceId(resolvedWorkspaceId);
        writeActiveWorkspaceId(resolvedWorkspaceId);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载工作空间失败");
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setDatasources([]);
      setDatasourceId("");
      writeActiveDatasourceId("");
      return;
    }
    void (async () => {
      try {
        const bindingResult = await listWorkspaceDatasourceBindings(workspaceId);
        const nextDatasources = bindingResult.map((item) => ({
          id: item.datasourceId,
          name: item.datasourceName ?? item.datasourceId
        }));
        setDatasources(nextDatasources);
        const { datasourceIdFromQuery } = readModelingPageQueryContext();
        const preferredDatasourceId = datasourceIdFromQuery || readActiveDatasourceId();
        const resolvedDatasourceId =
          (preferredDatasourceId &&
            nextDatasources.find((item) => item.id === preferredDatasourceId)?.id) ||
          nextDatasources[0]?.id ||
          "";
        setDatasourceId(resolvedDatasourceId);
        writeActiveDatasourceId(resolvedDatasourceId);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载数据源绑定失败");
      }
    })();
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !datasourceId) {
      setDraft(null);
      setEdges([]);
      setPrecheck(null);
      return;
    }
    void (async () => {
      setBusy(true);
      setError("");
      try {
        const [tablePermission, draftResult] = await Promise.all([
          listWorkspaceDatasourceTablePermissions(workspaceId, datasourceId),
          getWorkspaceRelationshipDraft(workspaceId, datasourceId)
        ]);
        setPolicyVersion(tablePermission.policyVersion);
        setDraft(draftResult.draft);
        setActiveRevision(draftResult.activeRevision);
        setEdges(draftResult.draft?.edges ?? []);
        setPrecheck(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载关系图失败");
      } finally {
        setBusy(false);
      }
    })();
  }, [workspaceId, datasourceId]);

  const upsertEdge = (edge: WorkspaceRelationshipEdge) => {
    if (
      edge.bridge.left.dataset === edge.bridge.right.dataset &&
      edge.bridge.left.table === edge.bridge.right.table &&
      edge.bridge.left.column === edge.bridge.right.column
    ) {
      setError("非法自连接：左右端点不能完全相同。");
      return;
    }
    const signature = `${edge.bridge.left.dataset}.${edge.bridge.left.table}.${edge.bridge.left.column}:${edge.bridge.right.dataset}.${edge.bridge.right.table}.${edge.bridge.right.column}:${edge.bridge.operator}`;
    const hasDuplicate = edges.some((item) => {
      if (item.id === edge.id) {
        return false;
      }
      const current = `${item.bridge.left.dataset}.${item.bridge.left.table}.${item.bridge.left.column}:${item.bridge.right.dataset}.${item.bridge.right.table}.${item.bridge.right.column}:${item.bridge.operator}`;
      return current === signature;
    });
    if (hasDuplicate) {
      setError("重复关系边：同一 join path 仅允许一条边。");
      return;
    }
    setError("");
    setEdges((previous) => {
      const existed = previous.some((item) => item.id === edge.id);
      if (existed) {
        return previous.map((item) => (item.id === edge.id ? edge : item));
      }
      return [...previous, edge];
    });
  };

  const saveDraft = async () => {
    if (!workspaceId || !datasourceId) {
      setError("请先选择工作空间与数据源。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const nextDraft = await replaceWorkspaceRelationshipDraft(workspaceId, datasourceId, {
        policyVersion,
        edges
      });
      setDraft(nextDraft);
      setEdges(nextDraft.edges);
      setPrecheck(null);
      setMessage(`Draft 已保存（revision=${nextDraft.revision}）。`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存 draft 失败");
    } finally {
      setBusy(false);
    }
  };

  const runPrecheck = async () => {
    if (!draft) {
      setError("请先保存 draft。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await precheckWorkspaceRelationshipPublish(workspaceId, datasourceId, {
        policyVersion: draft.policyVersion,
        draftRevision: draft.revision
      });
      setPrecheck(result);
      setMessage(result.publish_precheck_passed ? "发布预检通过。" : "发布预检未通过。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "发布预检失败");
    } finally {
      setBusy(false);
    }
  };

  const runPublish = async () => {
    if (!draft) {
      setError("请先保存 draft。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await publishWorkspaceRelationshipDraft(workspaceId, datasourceId, {
        policyVersion: draft.policyVersion,
        draftRevision: draft.revision,
        representativeSqlSamples: ["SELECT 1"]
      });
      setActiveRevision(result.activeRevision);
      setMessage(`发布成功，activeRevision=${result.activeRevision}。`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "发布失败");
    } finally {
      setBusy(false);
    }
  };

  const runRollback = async () => {
    if (!draft) {
      setError("请先保存 draft。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await rollbackWorkspaceRelationshipDraft(workspaceId, datasourceId, {
        policyVersion: draft.policyVersion,
        draftRevision: draft.revision,
        rollbackToRevision: draft.revision
      });
      setActiveRevision(result.activeRevision);
      setMessage(`回滚完成，activeRevision=${result.activeRevision}。`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "回滚失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-[var(--action-primary)]">
            <ArrowLeft className="h-4 w-4" />
            返回设置
          </Link>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Relationship Modeling</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            在 settings 工作区完成关系图建模、发布预检和发布/回滚。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border-default)] bg-white/90 p-4 sm:grid-cols-2">
        <NativeSelect
          value={workspaceId}
          onChange={(event) => {
            const nextWorkspaceId = event.target.value;
            setWorkspaceId(nextWorkspaceId);
            writeActiveWorkspaceId(nextWorkspaceId);
          }}
          aria-label="选择工作空间"
        >
          <NativeSelectOption value="">请选择工作空间</NativeSelectOption>
          {workspaces.map((workspace) => (
            <NativeSelectOption key={workspace.id} value={workspace.id}>
              {workspace.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={datasourceId}
          onChange={(event) => {
            const nextDatasourceId = event.target.value;
            setDatasourceId(nextDatasourceId);
            writeActiveDatasourceId(nextDatasourceId);
          }}
          aria-label="选择数据源"
        >
          <NativeSelectOption value="">请选择数据源</NativeSelectOption>
          {datasources.map((datasource) => (
            <NativeSelectOption key={datasource.id} value={datasource.id}>
              {datasource.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {error ? <StateBlock variant="error">{error}</StateBlock> : null}
      {message ? <StateBlock variant="success">{message}</StateBlock> : null}

      <RelationshipModelingCanvas
        edges={edges}
        onCreateEdge={() => {
          setEditingEdge(undefined);
          setEditorOpen(true);
        }}
        onEditEdge={(edge) => {
          setEditingEdge(edge);
          setEditorOpen(true);
        }}
        onRemoveEdge={(edgeId) => {
          setEdges((previous) => previous.filter((item) => item.id !== edgeId));
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void saveDraft()} disabled={busy || !workspaceId || !datasourceId}>
          保存 Draft
        </Button>
      </div>

      <RelationshipPublishPanel
        draft={draft}
        activeRevision={activeRevision}
        precheck={precheck}
        busy={busy}
        onPrecheck={() => {
          void runPrecheck();
        }}
        onPublish={() => {
          void runPublish();
        }}
        onRollback={() => {
          void runRollback();
        }}
      />

      <RelationshipEdgeEditorDialog
        open={editorOpen}
        edge={editingEdge}
        onOpenChange={setEditorOpen}
        onSubmit={(edge) => {
          upsertEdge(edge);
        }}
      />
    </div>
  );
}
