"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelingGraphPayload } from "@text2sql/shared-types";
import {
  deployWorkspaceModeling,
  detectWorkspaceModelingSchemaChanges,
  getWorkspaceModelingGraph,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces,
  precheckWorkspaceModelingDeploy,
  resolveWorkspaceModelingSchemaChange,
  upsertWorkspaceModelingGraph,
  type PrecheckWorkspaceModelingDeployResult,
  type WorkspaceModelingGraphSnapshot
} from "@/lib/admin-api-client";
import {
  readActiveDatasourceId,
  readActiveWorkspaceId,
  writeActiveDatasourceId,
  writeActiveWorkspaceId
} from "@/lib/datasource-session-context";
import { ModelingDetailsPanel } from "@/components/settings/modeling/modeling-details-panel";
import { ModelingDeployPanel } from "@/components/settings/modeling/modeling-deploy-panel";
import { ModelingFlowCanvas } from "@/components/settings/modeling/modeling-flow-canvas";
import { ModelingSchemaChangePanel } from "@/components/settings/modeling/modeling-schema-change-panel";
import {
  ModelingSidebarTree,
  type ModelingSidebarNode
} from "@/components/settings/modeling/modeling-sidebar-tree";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";

const MODELING_SELECTED_VIEW_ID_STORAGE_KEY = "text2sql.modeling.selectViewId";

function createEmptyGraphPayload(): ModelingGraphPayload {
  return {
    models: [],
    relationships: [],
    calculatedFields: [],
    views: [],
    schemaChanges: []
  };
}

function normalizeGraphPayload(payload: ModelingGraphPayload | null | undefined): ModelingGraphPayload {
  if (!payload) {
    return createEmptyGraphPayload();
  }
  return {
    models: payload.models,
    relationships: payload.relationships,
    calculatedFields: payload.calculatedFields,
    views: payload.views,
    schemaChanges: payload.schemaChanges
  };
}

function readModelingPageQueryContext(): {
  workspaceIdFromQuery: string;
  datasourceIdFromQuery: string;
  viewIdFromQuery: string;
} {
  if (typeof window === "undefined") {
    return {
      workspaceIdFromQuery: "",
      datasourceIdFromQuery: "",
      viewIdFromQuery: ""
    };
  }
  const searchParams = new URLSearchParams(window.location.search);
  return {
    workspaceIdFromQuery: searchParams.get("workspaceId")?.trim() ?? "",
    datasourceIdFromQuery:
      searchParams.get("datasourceId")?.trim() ??
      searchParams.get("datasource")?.trim() ??
      "",
    viewIdFromQuery: searchParams.get("viewId")?.trim() ?? ""
  };
}

function syncModelingPageQueryContext(workspaceId: string, datasourceId: string): void {
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
  if (datasourceId) {
    next.searchParams.set("datasourceId", datasourceId);
  } else {
    next.searchParams.delete("datasourceId");
  }
  const nextPath = `${next.pathname}${next.search}${next.hash}`;
  if (nextPath !== current) {
    window.history.replaceState({}, "", nextPath);
  }
}

function resolveNextSelectedNode(
  graphPayload: ModelingGraphPayload,
  previousNode: ModelingSidebarNode | null,
  preferredViewIds: string[] = []
): ModelingSidebarNode | null {
  const matchedPreferredViewId = preferredViewIds
    .map((item) => item.trim())
    .find((item) => item && graphPayload.views.some((view) => view.id === item));
  if (matchedPreferredViewId) {
    return {
      kind: "view",
      id: matchedPreferredViewId
    };
  }
  if (previousNode?.kind === "model") {
    const matchedModel = graphPayload.models.find((item) => item.id === previousNode.id);
    if (matchedModel) {
      return {
        kind: "model",
        id: matchedModel.id
      };
    }
  }
  if (previousNode?.kind === "view") {
    const matchedView = graphPayload.views.find((item) => item.id === previousNode.id);
    if (matchedView) {
      return {
        kind: "view",
        id: matchedView.id
      };
    }
  }
  if (previousNode?.kind === "relationship") {
    const matchedRelationship = graphPayload.relationships.find(
      (item) => item.id === previousNode.id
    );
    if (matchedRelationship) {
      return {
        kind: "relationship",
        id: matchedRelationship.id
      };
    }
  }
  if (graphPayload.models[0]) {
    return {
      kind: "model",
      id: graphPayload.models[0].id
    };
  }
  if (graphPayload.views[0]) {
    return {
      kind: "view",
      id: graphPayload.views[0].id
    };
  }
  return null;
}

function resolveSelectedNodeSummary(selectedNode: ModelingSidebarNode | null): string {
  if (!selectedNode) {
    return "未选择";
  }
  if (selectedNode.kind === "relationship") {
    return `relationship · ${selectedNode.id}`;
  }
  return `${selectedNode.kind} · ${selectedNode.id}`;
}

export default function ModelingWorkspacePage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [datasourceId, setDatasourceId] = useState("");
  const [policyVersion, setPolicyVersion] = useState(0);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [datasources, setDatasources] = useState<Array<{ id: string; name: string }>>([]);
  const [snapshot, setSnapshot] = useState<WorkspaceModelingGraphSnapshot | null>(null);
  const [graphPayload, setGraphPayload] = useState<ModelingGraphPayload>(createEmptyGraphPayload());
  const [selectedNode, setSelectedNode] = useState<ModelingSidebarNode | null>(null);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [hasPendingDraftChanges, setHasPendingDraftChanges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [schemaChangeItems, setSchemaChangeItems] = useState<
    Array<{
      id: string;
      kind: "deleted_table" | "deleted_column" | "modified_column_type" | "other";
      status: "detected" | "resolved";
      summary: string;
    }>
  >([]);
  const [deployPrecheck, setDeployPrecheck] = useState<PrecheckWorkspaceModelingDeployResult | null>(
    null
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const latestSnapshotLoadTokenRef = useRef(0);

  const scrollToLayoutPane = useCallback((paneId: string): void => {
    if (typeof window === "undefined") {
      return;
    }
    const pane = window.document.getElementById(paneId);
    pane?.scrollIntoView({
      block: "start",
      behavior: "smooth"
    });
  }, []);

  const loadModelingSnapshot = useCallback(
    async (workspaceIdValue: string, datasourceIdValue: string): Promise<void> => {
      const loadToken = latestSnapshotLoadTokenRef.current + 1;
      latestSnapshotLoadTokenRef.current = loadToken;
      const [tablePermissionResult, graphResult] = await Promise.all([
        listWorkspaceDatasourceTablePermissions(workspaceIdValue, datasourceIdValue),
        getWorkspaceModelingGraph(workspaceIdValue, datasourceIdValue)
      ]);
      if (loadToken !== latestSnapshotLoadTokenRef.current) {
        return;
      }
      const nextGraphPayload = normalizeGraphPayload(graphResult.draft?.graphPayload);
      const { viewIdFromQuery } = readModelingPageQueryContext();
      const preferredViewIdFromSession =
        typeof window !== "undefined"
          ? window.sessionStorage
              .getItem(MODELING_SELECTED_VIEW_ID_STORAGE_KEY)
              ?.trim() ?? ""
          : "";
      const preferredViewIds = [viewIdFromQuery, preferredViewIdFromSession].filter(Boolean);
      const nextPolicyVersion =
        graphResult.draft?.policyVersion ?? tablePermissionResult.policyVersion;
      setPolicyVersion(nextPolicyVersion);
      setSnapshot(graphResult);
      setGraphPayload(nextGraphPayload);
      setSelectedNode((previous) =>
        resolveNextSelectedNode(nextGraphPayload, previous, preferredViewIds)
      );
      if (preferredViewIdFromSession && typeof window !== "undefined") {
        window.sessionStorage.removeItem(MODELING_SELECTED_VIEW_ID_STORAGE_KEY);
      }
      setSchemaChangeItems(
        nextGraphPayload.schemaChanges.map((item) => ({
          id: item.id,
          kind: item.kind,
          status: item.status,
          summary: item.summary
        }))
      );
      setDetailsDirty(false);
      setHasPendingDraftChanges(false);
    },
    []
  );

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
        syncModelingPageQueryContext(workspaceId, resolvedDatasourceId);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载数据源绑定失败");
      }
    })();
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !datasourceId) {
      latestSnapshotLoadTokenRef.current += 1;
      setSnapshot(null);
      setGraphPayload(createEmptyGraphPayload());
      setSelectedNode(null);
      setDetailsDirty(false);
      setHasPendingDraftChanges(false);
      return;
    }
    void (async () => {
      setBusy(true);
      setError("");
      try {
        await loadModelingSnapshot(workspaceId, datasourceId);
        setDeployPrecheck(null);
        setMessage("");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载建模图失败");
      } finally {
        setBusy(false);
      }
    })();
  }, [datasourceId, loadModelingSnapshot, workspaceId]);

  const hasUndeployedChanges = useMemo(() => {
    if (!snapshot?.draft) {
      return false;
    }
    return snapshot.draft.revision !== snapshot.activeRevision;
  }, [snapshot]);

  const flowAutoLayoutKey = useMemo(
    () => `${workspaceId}:${datasourceId}`,
    [datasourceId, workspaceId]
  );

  const saveModelingGraph = async (): Promise<void> => {
    if (!workspaceId || !datasourceId) {
      setError("请先选择工作空间与数据源。");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const nextSnapshot = await upsertWorkspaceModelingGraph(workspaceId, datasourceId, {
        policyVersion,
        models: graphPayload.models,
        relationships: graphPayload.relationships,
        calculatedFields: graphPayload.calculatedFields,
        views: graphPayload.views,
        schemaChanges: graphPayload.schemaChanges
      });
      const nextGraphPayload = normalizeGraphPayload(nextSnapshot.draft?.graphPayload);
      setSnapshot(nextSnapshot);
      setGraphPayload(nextGraphPayload);
      setPolicyVersion(nextSnapshot.draft?.policyVersion ?? policyVersion);
      setSelectedNode((previous) => resolveNextSelectedNode(nextGraphPayload, previous));
      setDetailsDirty(false);
      setHasPendingDraftChanges(false);
      setMessage(`Modeling Draft 已保存（revision=${nextSnapshot.draft?.revision ?? "-"}）。`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存建模图失败");
    } finally {
      setSaving(false);
    }
  };

  const detectSchemaChanges = async (): Promise<void> => {
    if (!workspaceId || !datasourceId) {
      return;
    }
    setDeploying(true);
    setError("");
    try {
      const detected = await detectWorkspaceModelingSchemaChanges(workspaceId, datasourceId, {
        policyVersion
      });
      setSchemaChangeItems(detected.changes);
      await loadModelingSnapshot(workspaceId, datasourceId);
      setDeployPrecheck(null);
      setMessage(`Schema change detect 完成，未解决项 ${detected.unresolvedHighRiskCount}。`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "schema change detect 失败");
    } finally {
      setDeploying(false);
    }
  };

  const resolveSchemaChange = async (changeId: string): Promise<void> => {
    if (!workspaceId || !datasourceId) {
      return;
    }
    setDeploying(true);
    setError("");
    try {
      const resolved = await resolveWorkspaceModelingSchemaChange(workspaceId, datasourceId, {
        policyVersion,
        changeId
      });
      await loadModelingSnapshot(workspaceId, datasourceId);
      setDeployPrecheck(null);
      setMessage(
        resolved.alreadyResolved
          ? "Schema change 已是 resolved 状态。"
          : "Schema change 已标记为 resolved。"
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "schema change resolve 失败");
    } finally {
      setDeploying(false);
    }
  };

  const runDeployPrecheck = async (): Promise<void> => {
    if (!workspaceId || !datasourceId) {
      return;
    }
    if (hasPendingDraftChanges) {
      setError("检测到未保存的建模改动，请先点击“保存 Modeling Draft”后再执行 precheck。");
      return;
    }
    setDeploying(true);
    setError("");
    try {
      const precheck = await precheckWorkspaceModelingDeploy(workspaceId, datasourceId, {
        policyVersion,
        draftRevision: snapshot?.draft?.revision
      });
      setDeployPrecheck(precheck);
      setMessage(precheck.pass ? "Deploy precheck 通过。" : "Deploy precheck 未通过，请先处理阻断项。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "deploy precheck 失败");
    } finally {
      setDeploying(false);
    }
  };

  const deployRevision = async (): Promise<void> => {
    if (!workspaceId || !datasourceId) {
      return;
    }
    if (hasPendingDraftChanges) {
      setError("检测到未保存的建模改动，请先保存 Modeling Draft 后再激活 revision。");
      return;
    }
    setDeploying(true);
    setError("");
    try {
      await deployWorkspaceModeling(workspaceId, datasourceId, {
        policyVersion,
        draftRevision: snapshot?.draft?.revision
      });
      await loadModelingSnapshot(workspaceId, datasourceId);
      setDeployPrecheck(null);
      setMessage("Modeling revision 已激活。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "deploy 失败");
    } finally {
      setDeploying(false);
    }
  };

  const selectNodeWithDirtyGuard = (nextNode: ModelingSidebarNode | null): void => {
    if (!nextNode) {
      if (detailsDirty && typeof window !== "undefined") {
        const confirmed = window.confirm("当前详情面板有未保存改动，确认清除选中吗？");
        if (!confirmed) {
          return;
        }
      }
      setSelectedNode(null);
      setDetailsDirty(false);
      return;
    }
    const isSame =
      selectedNode?.kind === nextNode.kind && selectedNode?.id === nextNode.id;
    if (isSame) {
      return;
    }
    if (detailsDirty && typeof window !== "undefined") {
      const confirmed = window.confirm("当前详情面板有未保存改动，确认切换对象/关系吗？");
      if (!confirmed) {
        return;
      }
    }
    setSelectedNode(nextNode);
    setDetailsDirty(false);
  };

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-[var(--action-primary)]"
          >
            <ArrowLeft className="h-4 w-4" />
            返回设置
          </Link>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Modeling Workspace</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            统一管理 Models / Views / Calculated Fields / Relationships，保留 workspace 级上下文。
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
            syncModelingPageQueryContext(nextWorkspaceId, "");
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
            syncModelingPageQueryContext(workspaceId, nextDatasourceId);
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

      <section
        className="space-y-2 rounded-lg border border-[var(--border-default)] bg-white/90 px-4 py-3"
        data-testid="modeling-top-status-bar"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-muted)] px-2 py-0.5">
              Draft {snapshot?.draft?.revision ?? "-"}
            </span>
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-muted)] px-2 py-0.5">
              Active {snapshot?.activeRevision ?? "-"}
            </span>
            <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-muted)] px-2 py-0.5">
              Policy {policyVersion}
            </span>
            <span className="truncate">Current Context: {resolveSelectedNodeSummary(selectedNode)}</span>
          </div>
          <Button
            onClick={() => {
              void saveModelingGraph();
            }}
            disabled={busy || saving || deploying || !workspaceId || !datasourceId}
          >
            保存 Modeling Draft
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span>Models {graphPayload.models.length}</span>
          <span>Views {graphPayload.views.length}</span>
          <span>Relationships {graphPayload.relationships.length}</span>
        </div>

        {hasUndeployedChanges ? (
          <StateBlock variant="idle">
            检测到 undeployed draft（draft revision 与 active revision 不一致）。
          </StateBlock>
        ) : (
          <StateBlock variant="idle">当前无已保存但未部署的 revision 差异。</StateBlock>
        )}
        {detailsDirty ? (
          <StateBlock variant="idle">详情面板存在未保存改动，切换对象前会进行确认。</StateBlock>
        ) : null}
        {hasPendingDraftChanges ? (
          <StateBlock variant="idle">
            当前改动尚未写入 draft revision，deploy/precheck 前请先保存 Modeling Draft。
          </StateBlock>
        ) : null}
      </section>

      <section
        className="rounded-lg border border-[var(--border-default)] bg-white/90 p-2 sm:hidden"
        data-testid="modeling-mobile-quick-access"
      >
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              scrollToLayoutPane("modeling-canvas-pane");
            }}
          >
            定位到画布
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              scrollToLayoutPane("modeling-assets-pane");
            }}
          >
            资产树
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              scrollToLayoutPane("modeling-context-pane");
            }}
          >
            详情/部署
          </Button>
        </div>
      </section>

      <section
        className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px] 2xl:grid-cols-[280px_minmax(0,1fr)_340px]"
        data-testid="modeling-layout-parity-shell"
      >
        <div
          id="modeling-assets-pane"
          className="order-2 xl:order-1"
          data-testid="modeling-layout-left-pane"
        >
          <ModelingSidebarTree
            models={graphPayload.models}
            views={graphPayload.views}
            selectedNode={selectedNode}
            onSelectNode={(node) => {
              selectNodeWithDirtyGuard(node);
            }}
          />
        </div>

        <div
          id="modeling-canvas-pane"
          className="order-1 xl:order-2"
          data-testid="modeling-layout-canvas-pane"
        >
          <ModelingFlowCanvas
            graphPayload={graphPayload}
            selectedNode={selectedNode}
            busy={busy || saving}
            autoLayoutKey={flowAutoLayoutKey}
            onSelectNode={selectNodeWithDirtyGuard}
          />
        </div>

        <div
          id="modeling-context-pane"
          className="order-3 space-y-4"
          data-testid="modeling-layout-context-pane"
        >
          <ModelingDetailsPanel
            selectedNode={selectedNode}
            models={graphPayload.models}
            views={graphPayload.views}
            calculatedFields={graphPayload.calculatedFields}
            relationships={graphPayload.relationships}
            busy={busy || saving}
            onDirtyChange={setDetailsDirty}
            onMetadataSave={async (input, node) => {
              setGraphPayload((previous) => {
                if (node.kind === "model") {
                  return {
                    ...previous,
                    models: previous.models.map((item) =>
                      item.id === node.id
                        ? {
                            ...item,
                            displayName: input.displayName,
                            description: input.description
                          }
                        : item
                    )
                  };
                }
                return {
                  ...previous,
                  views: previous.views.map((item) =>
                    item.id === node.id
                      ? {
                          ...item,
                          displayName: input.displayName,
                          description: input.description
                        }
                      : item
                  )
                };
              });
              setHasPendingDraftChanges(true);
              setDeployPrecheck(null);
              setMessage("Metadata 已更新，点击“保存 Modeling Draft”后提交。");
            }}
            onCalculatedFieldsSave={async (fields) => {
              setGraphPayload((previous) => ({
                ...previous,
                calculatedFields: fields
              }));
              setHasPendingDraftChanges(true);
              setDeployPrecheck(null);
              setMessage("Calculated Fields 已更新，点击“保存 Modeling Draft”后提交。");
            }}
            onRelationshipsSave={async (relationships) => {
              setGraphPayload((previous) => ({
                ...previous,
                relationships
              }));
              setHasPendingDraftChanges(true);
              setDeployPrecheck(null);
              setSelectedNode((previous) => {
                if (previous?.kind !== "relationship") {
                  return previous;
                }
                return relationships.some((item) => item.id === previous.id) ? previous : null;
              });
              setMessage("Relationships 已更新，点击“保存 Modeling Draft”后提交。");
            }}
            onSelectRelationship={(relationshipId) => {
              if (!relationshipId) {
                setSelectedNode((previous) =>
                  previous?.kind === "relationship" ? null : previous
                );
                return;
              }
              setSelectedNode({
                kind: "relationship",
                id: relationshipId
              });
            }}
          />

          <ModelingSchemaChangePanel
            busy={busy || saving || deploying}
            items={schemaChangeItems}
            unresolvedCount={schemaChangeItems.filter((item) => item.status === "detected").length}
            onDetect={detectSchemaChanges}
            onResolve={resolveSchemaChange}
          />

          <ModelingDeployPanel
            busy={busy || saving || deploying}
            hasUndeployedChanges={hasUndeployedChanges}
            precheck={deployPrecheck}
            onPrecheck={runDeployPrecheck}
            onDeploy={deployRevision}
          />
        </div>
      </section>
    </div>
  );
}
