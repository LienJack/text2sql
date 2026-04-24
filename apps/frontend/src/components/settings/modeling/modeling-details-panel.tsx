"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ModelingGraphCalculatedField,
  ModelingGraphModel,
  ModelingGraphRelationship,
  ModelingGraphView
} from "@text2sql/shared-types";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { ModelingCalculatedFieldEditor } from "@/components/settings/modeling/modeling-calculated-field-editor";
import { ModelingMetadataEditor, type MetadataTarget } from "@/components/settings/modeling/modeling-metadata-editor";
import { ModelingRelationshipEditor } from "@/components/settings/modeling/modeling-relationship-editor";
import type { ModelingSidebarNode } from "@/components/settings/modeling/modeling-sidebar-tree";

type DetailsTab = "metadata" | "calculatedField" | "relationship";
export type ModelingDetailsEditorIntent = {
  tab: DetailsTab;
  relationshipId?: string | null;
  requestId: number;
};
type PreviewResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
};

function resolveMetadataTarget(
  selectedNode: ModelingSidebarNode | null,
  models: ModelingGraphModel[],
  views: ModelingGraphView[]
): MetadataTarget | null {
  if (!selectedNode) {
    return null;
  }
  if (selectedNode.kind === "model") {
    const model = models.find((item) => item.id === selectedNode.id);
    if (!model) {
      return null;
    }
    return {
      kind: "model",
      id: model.id,
      title: model.displayName?.trim() || model.modelName || model.tableName,
      technicalName: model.tableName,
      displayName: model.displayName,
      description: model.description
    };
  }
  const view = views.find((item) => item.id === selectedNode.id);
  if (!view) {
    return null;
  }
  return {
    kind: "view",
    id: view.id,
    title: view.displayName?.trim() || view.name,
    technicalName: view.name,
    displayName: view.displayName,
    description: view.description
  };
}

export function ModelingDetailsPanel(props: {
  selectedNode: ModelingSidebarNode | null;
  models: ModelingGraphModel[];
  views: ModelingGraphView[];
  calculatedFields: ModelingGraphCalculatedField[];
  relationships: ModelingGraphRelationship[];
  busy?: boolean;
  onMetadataSave: (
    input: { displayName: string | null; description: string | null },
    selectedNode: ModelingSidebarNode
  ) => Promise<void> | void;
  onCalculatedFieldsSave: (
    fields: ModelingGraphCalculatedField[]
  ) => Promise<void> | void;
  onRelationshipsSave: (
    relationships: ModelingGraphRelationship[]
  ) => Promise<void> | void;
  onLoadPreview?: (input: {
    targetKind: "model" | "view";
    targetId: string;
    limit?: number;
  }) => Promise<PreviewResult>;
  onDeleteTarget?: (input: {
    targetKind: "model" | "view";
    targetId: string;
  }) => Promise<void> | void;
  onSelectRelationship?: (relationshipId: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  requestedEditorIntent?: ModelingDetailsEditorIntent | null;
}) {
  const {
    selectedNode,
    models,
    views,
    calculatedFields,
    relationships,
    busy,
    onMetadataSave,
    onCalculatedFieldsSave,
    onRelationshipsSave,
    onLoadPreview,
    onDeleteTarget,
    onSelectRelationship,
    onDirtyChange,
    requestedEditorIntent
  } = props;
  const [tab, setTab] = useState<DetailsTab>("metadata");
  const [editorDirty, setEditorDirty] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const onSelectRelationshipRef = useRef(onSelectRelationship);
  const requestedIntentTab = requestedEditorIntent?.tab;
  const requestedIntentRelationshipId = requestedEditorIntent?.relationshipId ?? null;
  const requestedIntentRequestId = requestedEditorIntent?.requestId ?? -1;
  const tabSwitchDisabled = Boolean(busy);

  useEffect(() => {
    if (selectedNode?.kind === "relationship") {
      setTab("relationship");
    } else {
      setTab("metadata");
    }
    setEditorDirty(false);
    setPreviewError("");
    setPreviewData(null);
  }, [selectedNode?.kind, selectedNode?.id]);

  useEffect(() => {
    onDirtyChange?.(editorDirty);
  }, [editorDirty, onDirtyChange]);

  useEffect(() => {
    onSelectRelationshipRef.current = onSelectRelationship;
  }, [onSelectRelationship]);

  useEffect(() => {
    if (!requestedIntentTab || tabSwitchDisabled) {
      return;
    }
    if (tab !== requestedIntentTab) {
      if (editorDirty && typeof window !== "undefined") {
        const confirmed = window.confirm("当前编辑器有未保存改动，确认切换 Tab 吗？");
        if (!confirmed) {
          return;
        }
      }
      setEditorDirty(false);
      setTab(requestedIntentTab);
    }
    if (requestedIntentTab === "relationship") {
      onSelectRelationshipRef.current?.(requestedIntentRelationshipId);
    }
  }, [
    editorDirty,
    requestedIntentRelationshipId,
    requestedIntentRequestId,
    requestedIntentTab,
    tabSwitchDisabled,
    tab
  ]);

  const selectedModel = useMemo(() => {
    if (selectedNode?.kind !== "model") {
      return null;
    }
    return models.find((item) => item.id === selectedNode.id) ?? null;
  }, [models, selectedNode]);

  const metadataTarget = useMemo(
    () => resolveMetadataTarget(selectedNode, models, views),
    [models, selectedNode, views]
  );

  const selectedRelationshipId =
    selectedNode?.kind === "relationship" ? selectedNode.id : null;

  const switchTab = (nextTab: DetailsTab): void => {
    if (tabSwitchDisabled) {
      return;
    }
    if (tab === nextTab) {
      return;
    }
    if (editorDirty && typeof window !== "undefined") {
      const confirmed = window.confirm("当前编辑器有未保存改动，确认切换 Tab 吗？");
      if (!confirmed) {
        return;
      }
    }
    setEditorDirty(false);
    setTab(nextTab);
  };

  const loadPreview = async (): Promise<void> => {
    if (!metadataTarget || !onLoadPreview) {
      return;
    }
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const result = await onLoadPreview({
        targetKind: metadataTarget.kind,
        targetId: metadataTarget.id,
        limit: 100
      });
      setPreviewData(result);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "加载预览失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const deleteTarget = async (): Promise<void> => {
    if (!metadataTarget || !onDeleteTarget) {
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `确认删除当前${metadataTarget.kind === "model" ? " Model" : " View"}吗？`
      );
      if (!confirmed) {
        return;
      }
    }
    await onDeleteTarget({
      targetKind: metadataTarget.kind,
      targetId: metadataTarget.id
    });
  };

  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--border-default)] bg-white/90 p-4"
      data-testid="modeling-details-panel"
    >
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Details Panel</p>
        <p className="text-xs text-[var(--text-secondary)]">
          当前对象：
          {metadataTarget ? `${metadataTarget.kind} · ${metadataTarget.title}` : "未选择"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={tab === "metadata" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            switchTab("metadata");
          }}
          disabled={tabSwitchDisabled}
        >
          Metadata
        </Button>
        <Button
          variant={tab === "calculatedField" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            switchTab("calculatedField");
          }}
          disabled={tabSwitchDisabled || !selectedModel}
        >
          Calculated Field
        </Button>
        <Button
          variant={tab === "relationship" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            switchTab("relationship");
          }}
          disabled={tabSwitchDisabled}
        >
          Relationship
        </Button>
      </div>

      {tab === "metadata" ? (
        metadataTarget ? (
          <div className="space-y-3">
            <ModelingMetadataEditor
              target={metadataTarget}
              busy={busy}
              onDirtyChange={setEditorDirty}
              onSave={async (input) => {
                if (!selectedNode || selectedNode.kind === "relationship") {
                  return;
                }
                await onMetadataSave(input, selectedNode);
                setEditorDirty(false);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || previewLoading || !onLoadPreview}
                onClick={() => {
                  void loadPreview();
                }}
              >
                {previewLoading ? "预览加载中..." : "加载 Data Preview"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !onDeleteTarget}
                onClick={() => {
                  void deleteTarget();
                }}
              >
                删除当前{metadataTarget.kind === "model" ? " Model" : " View"}
              </Button>
            </div>
            {previewError ? <StateBlock variant="error">{previewError}</StateBlock> : null}
            {previewData ? (
              <div className="space-y-2 rounded-md border border-[var(--border-default)] bg-white p-3">
                <p className="text-xs text-[var(--text-secondary)]">
                  Preview Rows: {previewData.rowCount}
                  {previewData.truncated ? "（已截断至 100 行）" : ""}
                </p>
                {previewData.columns.length === 0 || previewData.rows.length === 0 ? (
                  <StateBlock variant="idle">当前无可展示预览数据。</StateBlock>
                ) : (
                  <div className="max-h-56 overflow-auto rounded border border-[var(--border-default)]">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-[var(--surface-muted)] text-left">
                          {previewData.columns.map((column) => (
                            <th key={column} className="border-b border-[var(--border-default)] px-2 py-1">
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.rows.map((row, index) => (
                          <tr key={`preview-row-${index}`} className="odd:bg-white even:bg-[var(--surface-muted)]/40">
                            {previewData.columns.map((column) => (
                              <td key={`${index}:${column}`} className="border-b border-[var(--border-default)] px-2 py-1 align-top">
                                {String(row[column] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <StateBlock variant="idle">当前选中对象不支持 Metadata 编辑，请切换到 model/view。</StateBlock>
        )
      ) : null}

      {tab === "calculatedField" ? (
        <ModelingCalculatedFieldEditor
          model={selectedModel}
          calculatedFields={calculatedFields}
          busy={busy}
          onDirtyChange={setEditorDirty}
          onSave={async (fields) => {
            await onCalculatedFieldsSave(fields);
            setEditorDirty(false);
          }}
        />
      ) : null}

      {tab === "relationship" ? (
        <ModelingRelationshipEditor
          models={models}
          relationships={relationships}
          selectedRelationshipId={selectedRelationshipId}
          defaultFromTable={selectedModel?.tableName}
          requestedEditorIntent={
            requestedIntentTab === "relationship"
              ? {
                  relationshipId: requestedIntentRelationshipId,
                  requestId: requestedIntentRequestId
                }
              : null
          }
          onSelectRelationship={onSelectRelationship}
          busy={busy}
          onDirtyChange={setEditorDirty}
          onSave={async (relationships) => {
            await onRelationshipsSave(relationships);
            setEditorDirty(false);
          }}
        />
      ) : null}

      {!selectedNode ? (
        <StateBlock variant="idle">
          请先在左侧树中选择对象，然后在此面板编辑。
        </StateBlock>
      ) : null}
    </section>
  );
}
