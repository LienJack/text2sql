"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelingGraphPayload } from "@text2sql/shared-types";
import {
  AdminApiError,
  deployWorkspaceModeling,
  detectWorkspaceModelingSchemaChanges,
  getWorkspaceModelingPreview,
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
import { ModelingModelDrawer } from "@/components/settings/modeling/modeling-model-drawer";
import { ModelingSchemaChangePanel } from "@/components/settings/modeling/modeling-schema-change-panel";
import {
  ModelingSidebarTree,
  type ModelingSidebarNode
} from "@/components/settings/modeling/modeling-sidebar-tree";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";

const MODELING_SELECTED_VIEW_ID_STORAGE_KEY = "text2sql.modeling.selectViewId";
const POLICY_VERSION_CONFLICT_ERROR_CODES = new Set([
  "WORKSPACE_DATASOURCE_POLICY_VERSION_CONFLICT",
  "POLICY_VERSION_CONFLICT"
]);

function isPolicyVersionConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code =
    error instanceof AdminApiError && typeof error.code === "string"
      ? error.code
      : undefined;
  if (code && POLICY_VERSION_CONFLICT_ERROR_CODES.has(code)) {
    return true;
  }
  return error.message.includes("policyVersion 已过期");
}

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

function sanitizeIdentifierPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildNextModelDraftName(existingTableNames: string[]): string {
  const existing = new Set(existingTableNames.map((item) => sanitizeIdentifierPart(item)));
  let next = existing.size + 1;
  while (next < 10000) {
    const candidate = `new_model_${next}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
    next += 1;
  }
  return `new_model_${Date.now()}`;
}

type ModelingDeployState = "undeployed" | "synced";

export default function ModelingWorkspacePage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [datasourceId, setDatasourceId] = useState("");
  const [policyVersion, setPolicyVersion] = useState(0);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [datasources, setDatasources] = useState<Array<{ id: string; name: string }>>([]);
  const [snapshot, setSnapshot] = useState<WorkspaceModelingGraphSnapshot | null>(null);
  const [graphPayload, setGraphPayload] = useState<ModelingGraphPayload>(createEmptyGraphPayload());
  const [selectedNode, setSelectedNode] = useState<ModelingSidebarNode | null>(null);
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false);
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
      setModelDrawerOpen(false);
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
      setModelDrawerOpen(false);
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

  useEffect(() => {
    if (selectedNode?.kind === "model") {
      return;
    }
    setModelDrawerOpen(false);
  }, [selectedNode]);

  const hasSavedUndeployedChanges = useMemo(() => {
    if (!snapshot?.draft) {
      return false;
    }
    return snapshot.draft.revision !== snapshot.activeRevision;
  }, [snapshot]);
  const deployState: ModelingDeployState =
    hasPendingDraftChanges || hasSavedUndeployedChanges ? "undeployed" : "synced";
  const currentDraftRevision = snapshot?.draft?.revision;
  const hasCurrentDraftRevision = typeof currentDraftRevision === "number";
  const isPrecheckForCurrentDraft = Boolean(
    deployPrecheck &&
      hasCurrentDraftRevision &&
      deployPrecheck.draftRevision === currentDraftRevision
  );
  const canRunDeployPrecheck = hasSavedUndeployedChanges && !hasPendingDraftChanges;
  const canActivateRevision =
    canRunDeployPrecheck && isPrecheckForCurrentDraft && Boolean(deployPrecheck?.pass);

  const flowAutoLayoutKey = useMemo(
    () => `${workspaceId}:${datasourceId}`,
    [datasourceId, workspaceId]
  );
  const selectedWorkspaceName = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
      workspaceId,
    [workspaceId, workspaces]
  );
  const selectedModelForDrawer = useMemo(() => {
    if (selectedNode?.kind !== "model") {
      return null;
    }
    return graphPayload.models.find((model) => model.id === selectedNode.id) ?? null;
  }, [graphPayload.models, selectedNode]);

  const saveModelingGraph = async (): Promise<void> => {
    if (!workspaceId || !datasourceId) {
      setError("请先选择工作空间与数据源。");
      return;
    }
    const graphPayloadToSave = {
      models: graphPayload.models,
      relationships: graphPayload.relationships,
      calculatedFields: graphPayload.calculatedFields,
      views: graphPayload.views,
      schemaChanges: graphPayload.schemaChanges
    };
    const applySavedSnapshot = (
      nextSnapshot: WorkspaceModelingGraphSnapshot,
      fallbackPolicyVersion: number
    ): void => {
      const nextGraphPayload = normalizeGraphPayload(nextSnapshot.draft?.graphPayload);
      setSnapshot(nextSnapshot);
      setGraphPayload(nextGraphPayload);
      setPolicyVersion(nextSnapshot.draft?.policyVersion ?? fallbackPolicyVersion);
      setSelectedNode((previous) => resolveNextSelectedNode(nextGraphPayload, previous));
      setDetailsDirty(false);
      setHasPendingDraftChanges(false);
      setDeployPrecheck(null);
    };
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const nextSnapshot = await upsertWorkspaceModelingGraph(workspaceId, datasourceId, {
        policyVersion,
        ...graphPayloadToSave
      });
      applySavedSnapshot(nextSnapshot, policyVersion);
      setMessage(`Modeling Draft 已保存（revision=${nextSnapshot.draft?.revision ?? "-"}）。`);
    } catch (submitError) {
      if (isPolicyVersionConflictError(submitError)) {
        try {
          const latestPermissions = await listWorkspaceDatasourceTablePermissions(
            workspaceId,
            datasourceId
          );
          const latestPolicyVersion = latestPermissions.policyVersion;
          if (latestPolicyVersion !== policyVersion) {
            const retriedSnapshot = await upsertWorkspaceModelingGraph(
              workspaceId,
              datasourceId,
              {
                policyVersion: latestPolicyVersion,
                ...graphPayloadToSave
              }
            );
            applySavedSnapshot(retriedSnapshot, latestPolicyVersion);
            setMessage(
              `policyVersion 已从 ${policyVersion} 更新为 ${latestPolicyVersion}，已自动重试并保存成功（revision=${retriedSnapshot.draft?.revision ?? "-"}）。`
            );
            return;
          }
        } catch (retryError) {
          setError(
            retryError instanceof Error
              ? `policyVersion 自动刷新重试失败：${retryError.message}`
              : "policyVersion 自动刷新重试失败，请刷新后重试。"
          );
          return;
        }
      }
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
    if (!hasSavedUndeployedChanges) {
      setError("当前 Deploy State 为 synced，无需执行 precheck。");
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
    if (!hasSavedUndeployedChanges) {
      setError("当前 Deploy State 为 synced，无需激活 revision。");
      return;
    }
    if (!isPrecheckForCurrentDraft || !deployPrecheck?.pass) {
      setError("请先对当前 undeployed revision 执行并通过 Precheck，再激活 revision。");
      return;
    }
    setDeploying(true);
    setError("");
    try {
      await deployWorkspaceModeling(workspaceId, datasourceId, {
        policyVersion,
        draftRevision: currentDraftRevision
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
      setModelDrawerOpen(false);
      setDetailsDirty(false);
      return;
    }
    const isSame =
      selectedNode?.kind === nextNode.kind && selectedNode?.id === nextNode.id;
    if (isSame) {
      if (nextNode.kind === "model") {
        setModelDrawerOpen(true);
      }
      return;
    }
    if (detailsDirty && typeof window !== "undefined") {
      const confirmed = window.confirm("当前详情面板有未保存改动，确认切换对象/关系吗？");
      if (!confirmed) {
        return;
      }
    }
    setSelectedNode(nextNode);
    setModelDrawerOpen(nextNode.kind === "model");
    setDetailsDirty(false);
  };

  const createModelFromSidebar = (): void => {
    let createdModelId = "";
    setGraphPayload((previous) => {
      const nextTableName = buildNextModelDraftName(
        previous.models.map((item) => item.tableName)
      );
      const createdModel = {
        id: `model.${nextTableName}`,
        tableName: nextTableName,
        modelName: nextTableName,
        displayName: null,
        description: null,
        columns: [
          {
            name: "id",
            dataType: "integer",
            isNullable: false,
            isPrimaryKey: true,
            displayName: null,
            description: null
          }
        ]
      };
      createdModelId = createdModel.id;
      return {
        ...previous,
        models: [...previous.models, createdModel].sort((left, right) => left.id.localeCompare(right.id))
      };
    });
    if (createdModelId) {
      setSelectedNode({
        kind: "model",
        id: createdModelId
      });
      setModelDrawerOpen(true);
      setHasPendingDraftChanges(true);
      setDeployPrecheck(null);
      setMessage(`已新增 Model：${createdModelId}，请补充字段后保存 Modeling Draft。`);
    }
  };

  const deleteModelFromSidebar = (modelId: string): void => {
    const shouldCloseDrawer = selectedNode?.kind === "model" && selectedNode.id === modelId;
    setGraphPayload((previous) => {
      const target = previous.models.find((item) => item.id === modelId);
      if (!target) {
        return previous;
      }
      const targetTableName = target.tableName.trim().toLowerCase();
      return {
        ...previous,
        models: previous.models.filter((item) => item.id !== modelId),
        relationships: previous.relationships.filter((relationship) => {
          const leftTable = relationship.bridge.left.table.trim().toLowerCase();
          const rightTable = relationship.bridge.right.table.trim().toLowerCase();
          return leftTable !== targetTableName && rightTable !== targetTableName;
        }),
        calculatedFields: previous.calculatedFields.filter((field) => field.modelId !== modelId)
      };
    });
    setSelectedNode((previous) =>
      previous?.kind === "model" && previous.id === modelId ? null : previous
    );
    if (shouldCloseDrawer) {
      setModelDrawerOpen(false);
    }
    setHasPendingDraftChanges(true);
    setDeployPrecheck(null);
    setMessage(`已删除 Model：${modelId}，请保存 Modeling Draft。`);
  };

  const deleteViewFromSidebar = (viewId: string): void => {
    setGraphPayload((previous) => ({
      ...previous,
      views: previous.views.filter((item) => item.id !== viewId)
    }));
    setSelectedNode((previous) =>
      previous?.kind === "view" && previous.id === viewId ? null : previous
    );
    setHasPendingDraftChanges(true);
    setDeployPrecheck(null);
    setMessage(`已删除 View：${viewId}，请保存 Modeling Draft。`);
  };

  const loadPreviewForDetails = async (input: {
    targetKind: "model" | "view";
    targetId: string;
    limit?: number;
  }): Promise<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    truncated: boolean;
  }> => {
    if (!workspaceId || !datasourceId) {
      throw new Error("缺少 workspace/datasource，上下文不可预览。");
    }
    const result = await getWorkspaceModelingPreview(workspaceId, datasourceId, input);
    return {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated
    };
  };

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <div className="sr-only">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 text-sm text-[var(--action-primary)]"
            >
              <ArrowLeft className="h-4 w-4" />
              返回设置
            </Link>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Modeling Workbench</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Flowchart-first 工作台：左侧资产树 + 中央 ERD 画布 + 右侧上下文，统一管理 Models / Views / Relationships。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border-default)] bg-white/90 p-4 sm:grid-cols-2">
          <NativeSelect
            value={workspaceId}
            disabled
            aria-label="选择工作空间"
          >
            {workspaceId ? (
              <NativeSelectOption value={workspaceId}>
                {selectedWorkspaceName}
              </NativeSelectOption>
            ) : (
              <NativeSelectOption value="">当前无工作空间上下文</NativeSelectOption>
            )}
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
      </div>

      {error ? <StateBlock variant="error">{error}</StateBlock> : null}
      {message ? <StateBlock variant="success">{message}</StateBlock> : null}

      <section
        className="rounded-lg border border-[var(--border-default)] bg-white/90 px-3 py-2"
        data-testid="modeling-top-status-bar"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[var(--text-secondary)]">
            <span
              className={`rounded-full border px-2 py-0.5 ${
                deployState === "undeployed"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
              data-testid="modeling-deploy-state-chip"
            >
              Deploy State {deployState}
            </span>
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
        <div className="sr-only">
          <p>Draft {snapshot?.draft?.revision ?? "-"}</p>
          <p>Active {snapshot?.activeRevision ?? "-"}</p>
          <p>Policy {policyVersion}</p>
          <p>Current Context: {resolveSelectedNodeSummary(selectedNode)}</p>
          <p>Models {graphPayload.models.length}</p>
          <p>Views {graphPayload.views.length}</p>
          <p>Relationships {graphPayload.relationships.length}</p>
          <p>
            {deployState === "undeployed"
              ? hasPendingDraftChanges
                ? "Deploy State: undeployed。检测到未保存的 modeling 改动，请先保存 Modeling Draft。"
                : "Deploy State: undeployed。检测到 draft revision 与 active revision 不一致。"
              : "Deploy State: synced。当前无 undeployed revision。"}
          </p>
          {detailsDirty ? <p>详情面板存在未保存改动，切换对象前会进行确认。</p> : null}
        </div>
      </section>

      <section
        className="rounded-lg border border-[var(--border-default)] bg-white/90 p-2 sm:hidden"
        data-testid="modeling-mobile-quick-access"
      >
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-controls="modeling-canvas-pane"
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
            aria-controls="modeling-assets-pane"
            onClick={() => {
              scrollToLayoutPane("modeling-assets-pane");
            }}
          >
            资产树
          </Button>
        </div>
      </section>

      <section
        className="relative grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)]"
        data-testid="modeling-layout-parity-shell"
      >
        <div
          id="modeling-assets-pane"
          className="order-2 space-y-2 xl:order-1"
          data-testid="modeling-layout-left-pane"
        >
          <header className="px-1" data-testid="modeling-layout-left-header">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Assets
            </p>
          </header>
          <ModelingSidebarTree
            models={graphPayload.models}
            views={graphPayload.views}
            selectedNode={selectedNode}
            onSelectNode={(node) => {
              selectNodeWithDirtyGuard(node);
            }}
            onCreateModel={createModelFromSidebar}
            onDeleteModel={deleteModelFromSidebar}
            onDeleteView={deleteViewFromSidebar}
          />
        </div>

        <div
          id="modeling-canvas-pane"
          className="order-1 space-y-2 xl:order-2"
          data-testid="modeling-layout-canvas-pane"
        >
          <header className="px-1" data-testid="modeling-layout-canvas-header">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              ERD Workbench
            </p>
          </header>
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
          className="absolute -left-[9999px] top-0 w-[320px] space-y-4 2xl:w-[340px]"
          data-testid="modeling-layout-context-pane"
        >
          <header className="px-1" data-testid="modeling-layout-context-header">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Context
            </p>
          </header>
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
            onLoadPreview={loadPreviewForDetails}
            onDeleteTarget={async ({ targetKind, targetId }) => {
              if (targetKind === "model") {
                deleteModelFromSidebar(targetId);
                return;
              }
              deleteViewFromSidebar(targetId);
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
            deployState={deployState}
            hasUndeployedChanges={deployState === "undeployed"}
            hasPendingDraftChanges={hasPendingDraftChanges}
            canRunPrecheck={canRunDeployPrecheck}
            canDeploy={canActivateRevision}
            precheck={deployPrecheck}
            onPrecheck={runDeployPrecheck}
            onDeploy={deployRevision}
          />
        </div>
      </section>

      <ModelingModelDrawer
        open={Boolean(selectedModelForDrawer) && modelDrawerOpen}
        model={selectedModelForDrawer}
        relationships={graphPayload.relationships}
        onOpenChange={(open) => {
          if (open) {
            return;
          }
          selectNodeWithDirtyGuard(null);
        }}
        onLoadPreview={loadPreviewForDetails}
      />
    </div>
  );
}
