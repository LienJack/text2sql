"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ModelingGraphModel,
  ModelingGraphRelationship,
  ModelingGraphRelationshipType
} from "@text2sql/shared-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";

type RelationshipForm = {
  id: string;
  name: string;
  type: ModelingGraphRelationshipType;
  hasExplicitType: boolean;
  leftDataset: string;
  leftTable: string;
  leftColumn: string;
  rightDataset: string;
  rightTable: string;
  rightColumn: string;
  confidence: string;
};

const DEFAULT_RELATIONSHIP_TYPE: ModelingGraphRelationshipType = "many-to-one";

const RELATIONSHIP_TYPE_LABELS: Record<ModelingGraphRelationshipType, string> = {
  "many-to-one": "many-to-one",
  "one-to-many": "one-to-many",
  "one-to-one": "one-to-one"
};

function resolveRelationshipType(
  relationship?: ModelingGraphRelationship
): ModelingGraphRelationshipType {
  const nextType = relationship?.type ?? relationship?.cardinality;
  if (
    nextType === "many-to-one" ||
    nextType === "one-to-many" ||
    nextType === "one-to-one"
  ) {
    return nextType;
  }
  return DEFAULT_RELATIONSHIP_TYPE;
}

function toForm(relationship?: ModelingGraphRelationship): RelationshipForm {
  return {
    id: relationship?.id ?? "",
    name: relationship?.name ?? "",
    type: resolveRelationshipType(relationship),
    hasExplicitType: Boolean(relationship?.type ?? relationship?.cardinality),
    leftDataset: relationship?.bridge.left.dataset ?? "",
    leftTable: relationship?.bridge.left.table ?? "",
    leftColumn: relationship?.bridge.left.column ?? "",
    rightDataset: relationship?.bridge.right.dataset ?? "",
    rightTable: relationship?.bridge.right.table ?? "",
    rightColumn: relationship?.bridge.right.column ?? "",
    confidence: String(relationship?.confidence ?? 0.8)
  };
}

function makeRelationshipId(form: RelationshipForm): string {
  const left = `${form.leftTable.trim().toLowerCase()}_${form.leftColumn.trim().toLowerCase()}`;
  const right = `${form.rightTable.trim().toLowerCase()}_${form.rightColumn.trim().toLowerCase()}`;
  return `${left}__${right}`;
}

function normalizeTableName(value: string): string {
  return value.trim().toLowerCase();
}

function resolveTableOptions(models: ModelingGraphModel[]): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const model of models) {
    const tableName = model.tableName.trim();
    const tableKey = normalizeTableName(tableName);
    if (!tableName || seen.has(tableKey)) {
      continue;
    }
    seen.add(tableKey);
    options.push(tableName);
  }
  return options.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function resolveColumnOptions(models: ModelingGraphModel[], tableName: string): string[] {
  const tableKey = normalizeTableName(tableName);
  if (!tableKey) {
    return [];
  }
  const matchedModel = models.find((item) => normalizeTableName(item.tableName) === tableKey);
  if (!matchedModel) {
    return [];
  }
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const column of matchedModel.columns) {
    const columnName = column.name.trim();
    const columnKey = columnName.toLowerCase();
    if (!columnName || seen.has(columnKey)) {
      continue;
    }
    seen.add(columnKey);
    columns.push(columnName);
  }
  return columns;
}

function buildCreateForm(models: ModelingGraphModel[], preferredFromTable?: string): RelationshipForm {
  const tableOptions = resolveTableOptions(models);
  const preferredFromTableKey = normalizeTableName(preferredFromTable ?? "");
  const leftTable =
    tableOptions.find((item) => normalizeTableName(item) === preferredFromTableKey) ??
    tableOptions[0] ??
    "";
  const leftColumns = resolveColumnOptions(models, leftTable);
  const rightTable =
    tableOptions.find((item) => normalizeTableName(item) !== normalizeTableName(leftTable)) ??
    tableOptions[0] ??
    "";
  const rightColumns = resolveColumnOptions(models, rightTable);
  return {
    ...toForm(),
    leftTable,
    leftColumn: leftColumns[0] ?? "",
    rightTable,
    rightColumn: rightColumns[0] ?? ""
  };
}

export function ModelingRelationshipEditor(props: {
  relationships: ModelingGraphRelationship[];
  models?: ModelingGraphModel[];
  selectedRelationshipId?: string | null;
  defaultFromTable?: string;
  requestedEditorIntent?: {
    relationshipId?: string | null;
    requestId: number;
  } | null;
  busy?: boolean;
  onSave: (relationships: ModelingGraphRelationship[]) => Promise<void> | void;
  onSelectRelationship?: (relationshipId: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  inlinePanel?: boolean;
  dialogSubmitSaves?: boolean;
}) {
  const {
    relationships,
    models = [],
    selectedRelationshipId,
    defaultFromTable,
    requestedEditorIntent,
    busy,
    onSave,
    onSelectRelationship,
    onDirtyChange,
    inlinePanel = true,
    dialogSubmitSaves = false
  } = props;
  const [workingRelationships, setWorkingRelationships] = useState(relationships);
  const [form, setForm] = useState<RelationshipForm>(toForm());
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const handledIntentRequestIdRef = useRef(-1);

  useEffect(() => {
    setWorkingRelationships(relationships);
    setForm(buildCreateForm(models, defaultFromTable));
    setEditingRelationshipId(null);
    setError("");
  }, [defaultFromTable, models, relationships]);

  useEffect(() => {
    if (!selectedRelationshipId) {
      return;
    }
    const matchedRelationship = workingRelationships.find(
      (item) => item.id === selectedRelationshipId
    );
    if (!matchedRelationship) {
      return;
    }
    setForm(toForm(matchedRelationship));
    setEditingRelationshipId(matchedRelationship.id);
  }, [selectedRelationshipId, workingRelationships]);

  useEffect(() => {
    if (!requestedEditorIntent) {
      return;
    }
    if (requestedEditorIntent.requestId === handledIntentRequestIdRef.current) {
      return;
    }
    handledIntentRequestIdRef.current = requestedEditorIntent.requestId;
    const requestedRelationshipId = requestedEditorIntent.relationshipId?.trim() ?? "";
    if (requestedRelationshipId) {
      const matchedRelationship = workingRelationships.find(
        (item) => item.id === requestedRelationshipId
      );
      if (!matchedRelationship) {
        setError(`未找到 relationship：${requestedRelationshipId}`);
        return;
      }
      setForm(toForm(matchedRelationship));
      setEditingRelationshipId(matchedRelationship.id);
      setDialogOpen(true);
      setError("");
      return;
    }
    setForm(buildCreateForm(models, defaultFromTable));
    setEditingRelationshipId(null);
    setDialogOpen(true);
    setError("");
    onSelectRelationship?.(null);
  }, [defaultFromTable, models, onSelectRelationship, requestedEditorIntent, workingRelationships]);

  const dirty = useMemo(
    () => JSON.stringify(workingRelationships) !== JSON.stringify(relationships),
    [relationships, workingRelationships]
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const upsertRelationship = async (): Promise<void> => {
    const leftTable = form.leftTable.trim().toLowerCase();
    const rightTable = form.rightTable.trim().toLowerCase();
    const leftColumn = form.leftColumn.trim().toLowerCase();
    const rightColumn = form.rightColumn.trim().toLowerCase();
    if (!leftTable || !rightTable || !leftColumn || !rightColumn) {
      setError("关系两端 table/column 必填。");
      return;
    }
    if (
      leftTable === rightTable &&
      leftColumn === rightColumn &&
      form.leftDataset.trim() === form.rightDataset.trim()
    ) {
      setError("非法自连接：左右端点不能完全一致。");
      return;
    }
    const relationshipId = form.id.trim() || makeRelationshipId(form);
    const relationship: ModelingGraphRelationship = {
      id: relationshipId,
      name: form.name.trim() || undefined,
      source: "manual",
      confidence: Math.max(0, Math.min(1, Number(form.confidence) || 0)),
      bridge: {
        left: {
          dataset: form.leftDataset.trim(),
          table: leftTable,
          column: leftColumn
        },
        right: {
          dataset: form.rightDataset.trim(),
          table: rightTable,
          column: rightColumn
        },
        operator: "eq",
        confidence: Math.max(0, Math.min(1, Number(form.confidence) || 0))
      }
    };
    if (form.hasExplicitType || form.type !== DEFAULT_RELATIONSHIP_TYPE) {
      relationship.type = form.type;
      relationship.cardinality = form.type;
    }
    const signature = `${relationship.bridge.left.dataset}.${relationship.bridge.left.table}.${relationship.bridge.left.column}:${relationship.bridge.right.dataset}.${relationship.bridge.right.table}.${relationship.bridge.right.column}:${relationship.bridge.operator}`;
    const hasDuplicate = workingRelationships.some((item) => {
      if (item.id === relationship.id) {
        return false;
      }
      const current = `${item.bridge.left.dataset}.${item.bridge.left.table}.${item.bridge.left.column}:${item.bridge.right.dataset}.${item.bridge.right.table}.${item.bridge.right.column}:${item.bridge.operator}`;
      return current === signature;
    });
    if (hasDuplicate) {
      setError("重复关系边：同一 join path 仅允许一条边。");
      return;
    }
    const nextRelationships = (() => {
      const existed = workingRelationships.some((item) => item.id === relationship.id);
      if (existed) {
        return workingRelationships.map((item) =>
          item.id === relationship.id ? relationship : item
        );
      }
      return [...workingRelationships, relationship];
    })();
    if (dialogSubmitSaves) {
      setSubmitting(true);
      try {
        await onSave(nextRelationships);
        setWorkingRelationships(nextRelationships);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "保存 Relationship 失败");
        return;
      } finally {
        setSubmitting(false);
      }
    } else {
      setWorkingRelationships(nextRelationships);
    }
    setForm(buildCreateForm(models, defaultFromTable));
    setEditingRelationshipId(null);
    setDialogOpen(false);
    onSelectRelationship?.(relationship.id);
    setError("");
  };

  const save = async (): Promise<void> => {
    setSubmitting(true);
    setError("");
    try {
      await onSave(workingRelationships);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存 Relationship 失败");
    } finally {
      setSubmitting(false);
    }
  };

  const tableOptions = useMemo(() => resolveTableOptions(models), [models]);
  const leftColumnOptions = useMemo(
    () => resolveColumnOptions(models, form.leftTable),
    [form.leftTable, models]
  );
  const rightColumnOptions = useMemo(
    () => resolveColumnOptions(models, form.rightTable),
    [form.rightTable, models]
  );

  const openCreateDialog = (): void => {
    setForm(buildCreateForm(models, defaultFromTable));
    setEditingRelationshipId(null);
    setDialogOpen(true);
    setError("");
    onSelectRelationship?.(null);
  };

  const openEditDialog = (relationship: ModelingGraphRelationship): void => {
    setForm(toForm(relationship));
    setEditingRelationshipId(relationship.id);
    setDialogOpen(true);
    onSelectRelationship?.(relationship.id);
    setError("");
  };

  const handleTableChange = (side: "left" | "right", tableName: string): void => {
    const nextColumns = resolveColumnOptions(models, tableName);
    setForm((previous) => {
      if (side === "left") {
        const leftColumnStillValid = nextColumns.some(
          (column) => column.toLowerCase() === previous.leftColumn.trim().toLowerCase()
        );
        return {
          ...previous,
          leftTable: tableName,
          leftColumn: leftColumnStillValid ? previous.leftColumn : (nextColumns[0] ?? "")
        };
      }
      const rightColumnStillValid = nextColumns.some(
        (column) => column.toLowerCase() === previous.rightColumn.trim().toLowerCase()
      );
      return {
        ...previous,
        rightTable: tableName,
        rightColumn: rightColumnStillValid ? previous.rightColumn : (nextColumns[0] ?? "")
      };
    });
  };

  return (
    <>
      {inlinePanel ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Relationship Editor</p>
            <p className="text-xs text-[var(--text-secondary)]">
              在 Modeling Workspace 维护手工关系边，后续由 deploy 生效。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={openCreateDialog} disabled={tableOptions.length === 0}>
              添加关系
            </Button>
          </div>

          {workingRelationships.length === 0 ? (
            <StateBlock variant="idle">尚未定义 Relationship。</StateBlock>
          ) : (
            <div className="space-y-2">
              {workingRelationships.map((relationship) => (
                <div
                  key={relationship.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white p-3 ${
                    selectedRelationshipId === relationship.id
                      ? "border-[var(--action-primary)] ring-1 ring-[var(--action-primary)]/30"
                      : "border-[var(--border-default)]"
                  }`}
                  data-testid={`modeling-relationship-item-${relationship.id}`}
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {relationship.name ?? relationship.id}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {`${relationship.bridge.left.table}.${relationship.bridge.left.column} = ${relationship.bridge.right.table}.${relationship.bridge.right.column}`}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {`type: ${
                        RELATIONSHIP_TYPE_LABELS[resolveRelationshipType(relationship)]
                      }`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`编辑关系 ${relationship.id}`}
                      onClick={() => {
                        openEditDialog(relationship);
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`删除关系 ${relationship.id}`}
                      onClick={() => {
                        setWorkingRelationships((previous) =>
                          previous.filter((item) => item.id !== relationship.id)
                        );
                        if (selectedRelationshipId === relationship.id) {
                          onSelectRelationship?.(null);
                        }
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error ? <StateBlock variant="error">{error}</StateBlock> : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy || submitting || !dirty}>
              保存关系
            </Button>
            <Button
              variant="outline"
              disabled={busy || submitting || !dirty}
              onClick={() => {
                setWorkingRelationships(relationships);
                setForm(toForm());
                setEditingRelationshipId(null);
                setError("");
              }}
            >
              放弃改动
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setError("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRelationshipId ? "Edit relationship" : "Add relationship"}</DialogTitle>
            <DialogDescription>
              选择 From/To 的表与字段，并指定关系类型。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">* From</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Select
                  value={form.leftTable || undefined}
                  onValueChange={(value) => {
                    handleTableChange("left", value);
                  }}
                >
                  <SelectTrigger
                    aria-label="From table"
                    className="w-full bg-white text-[var(--text-primary)]"
                  >
                    <SelectValue placeholder="请选择表" />
                  </SelectTrigger>
                  <SelectContent
                    className="bg-white rounded-none"
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={4}
                  >
                    {tableOptions.map((tableName) => (
                      <SelectItem
                        key={`from-table-${tableName}`}
                        value={tableName}
                        className="rounded-none"
                      >
                        {tableName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={form.leftColumn || undefined}
                  onValueChange={(value) => {
                    setForm((previous) => ({ ...previous, leftColumn: value }));
                  }}
                  disabled={!form.leftTable}
                >
                  <SelectTrigger
                    aria-label="From field"
                    className="w-full bg-white text-[var(--text-primary)]"
                  >
                    <SelectValue placeholder="请选择字段" />
                  </SelectTrigger>
                  <SelectContent
                    className="bg-white rounded-none"
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={4}
                  >
                    {leftColumnOptions.map((columnName) => (
                      <SelectItem
                        key={`from-column-${columnName}`}
                        value={columnName}
                        className="rounded-none"
                      >
                        {columnName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">* To</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Select
                  value={form.rightTable || undefined}
                  onValueChange={(value) => {
                    handleTableChange("right", value);
                  }}
                >
                  <SelectTrigger
                    aria-label="To table"
                    className="w-full bg-white text-[var(--text-primary)]"
                  >
                    <SelectValue placeholder="请选择表" />
                  </SelectTrigger>
                  <SelectContent
                    className="bg-white rounded-none"
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={4}
                  >
                    {tableOptions.map((tableName) => (
                      <SelectItem
                        key={`to-table-${tableName}`}
                        value={tableName}
                        className="rounded-none"
                      >
                        {tableName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={form.rightColumn || undefined}
                  onValueChange={(value) => {
                    setForm((previous) => ({ ...previous, rightColumn: value }));
                  }}
                  disabled={!form.rightTable}
                >
                  <SelectTrigger
                    aria-label="To field"
                    className="w-full bg-white text-[var(--text-primary)]"
                  >
                    <SelectValue placeholder="请选择字段" />
                  </SelectTrigger>
                  <SelectContent
                    className="bg-white rounded-none"
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={4}
                  >
                    {rightColumnOptions.map((columnName) => (
                      <SelectItem
                        key={`to-column-${columnName}`}
                        value={columnName}
                        className="rounded-none"
                      >
                        {columnName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">* Type</p>
              <Select
                value={form.type}
                onValueChange={(value) => {
                  const nextType = value as ModelingGraphRelationshipType;
                  if (
                    nextType === "many-to-one" ||
                    nextType === "one-to-many" ||
                    nextType === "one-to-one"
                  ) {
                    setForm((previous) => ({
                      ...previous,
                      type: nextType,
                      hasExplicitType: true
                    }));
                  }
                }}
              >
                <SelectTrigger
                  aria-label="关系类型"
                  className="w-full bg-white text-[var(--text-primary)]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  className="bg-white rounded-none"
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                >
                  <SelectItem value="many-to-one" className="rounded-none">
                    many-to-one
                  </SelectItem>
                  <SelectItem value="one-to-many" className="rounded-none">
                    one-to-many
                  </SelectItem>
                  <SelectItem value="one-to-one" className="rounded-none">
                    one-to-one
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error ? <StateBlock variant="error">{error}</StateBlock> : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button disabled={submitting} onClick={() => void upsertRelationship()}>
              {submitting ? "Saving..." : editingRelationshipId ? "Update" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
