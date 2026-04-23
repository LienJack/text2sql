"use client";

import { useEffect, useMemo, useState } from "react";
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
  onSelectRelationship?: (relationshipId: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
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
    onSelectRelationship,
    onDirtyChange
  } = props;
  const [tab, setTab] = useState<DetailsTab>("metadata");
  const [editorDirty, setEditorDirty] = useState(false);

  useEffect(() => {
    if (selectedNode?.kind === "relationship") {
      setTab("relationship");
    } else {
      setTab("metadata");
    }
    setEditorDirty(false);
  }, [selectedNode?.kind, selectedNode?.id]);

  useEffect(() => {
    onDirtyChange?.(editorDirty);
  }, [editorDirty, onDirtyChange]);

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
        >
          Metadata
        </Button>
        <Button
          variant={tab === "calculatedField" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            switchTab("calculatedField");
          }}
          disabled={!selectedModel}
        >
          Calculated Field
        </Button>
        <Button
          variant={tab === "relationship" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            switchTab("relationship");
          }}
        >
          Relationship
        </Button>
      </div>

      {tab === "metadata" ? (
        metadataTarget ? (
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
          relationships={relationships}
          selectedRelationshipId={selectedRelationshipId}
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
