"use client";

import { X, Plus, Minus, Pencil } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { ModelingGraphModel, ModelingGraphRelationship } from "@text2sql/shared-types";
import { Badge } from "@/components/ui/badge";
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
import { StateBlock } from "@/components/ui/state-block";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PREVIEW_LIMIT = 20;

type PreviewResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
};

type RelationshipItem = {
  id: string;
  name: string;
  secondaryName?: string;
  from: string;
  to: string;
  type: string;
  relatedTable: string;
};

type EditableColumnDraft = {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  displayName: string;
  description: string;
};

type SaveModelMetadataInput = {
  modelId: string;
  displayName: string | null;
  description: string | null;
  columns: Array<{
    index: number;
    displayName: string | null;
    description: string | null;
  }>;
};

function normalizeText(value?: string | null): string {
  const normalized = value?.trim() ?? "";
  return normalized || "-";
}

function normalizeNullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function normalizeTableKey(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, maxLength = 28): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function resolveRelationshipType(relationship: ModelingGraphRelationship): string {
  return relationship.type ?? relationship.cardinality ?? "-";
}

function resolveRelationshipLabel(type: string): string {
  if (type === "many-to-one") {
    return "Many to one";
  }
  if (type === "one-to-many") {
    return "One to many";
  }
  if (type === "one-to-one") {
    return "One to one";
  }
  return "-";
}

function resolveRelationshipCounterpartTable(
  modelTableName: string,
  relationship: ModelingGraphRelationship
): string {
  const modelTableKey = normalizeTableKey(modelTableName);
  const leftTable = relationship.bridge?.left?.table?.trim() ?? "";
  const rightTable = relationship.bridge?.right?.table?.trim() ?? "";
  const leftTableKey = normalizeTableKey(leftTable);
  const rightTableKey = normalizeTableKey(rightTable);

  if (!modelTableKey) {
    return "-";
  }
  if (leftTableKey === modelTableKey && rightTableKey === modelTableKey) {
    return rightTable || leftTable || "-";
  }
  if (leftTableKey === modelTableKey) {
    return rightTable || "-";
  }
  if (rightTableKey === modelTableKey) {
    return leftTable || "-";
  }
  return "-";
}

function resolveBridgePath(tableName?: string, columnName?: string): string {
  const table = tableName?.trim() || "-";
  const column = columnName?.trim() || "-";
  return `${table}.${column}`;
}

function resolveModelRelationships(
  model: ModelingGraphModel,
  relationships: ModelingGraphRelationship[]
): RelationshipItem[] {
  const modelTableKey = normalizeTableKey(model.tableName);
  const relationshipItems = relationships.flatMap((relationship) => {
    const leftTable = relationship.bridge?.left?.table?.trim() ?? "";
    const rightTable = relationship.bridge?.right?.table?.trim() ?? "";
    const leftTableKey = normalizeTableKey(leftTable);
    const rightTableKey = normalizeTableKey(rightTable);
    if (leftTableKey !== modelTableKey && rightTableKey !== modelTableKey) {
      return [];
    }
    const from = resolveBridgePath(leftTable, relationship.bridge?.left?.column);
    const to = resolveBridgePath(rightTable, relationship.bridge?.right?.column);
    const relatedTable = resolveRelationshipCounterpartTable(model.tableName, relationship);
    const relationshipName = relationship.name?.trim() || undefined;
    return [
      {
        id: relationship.id,
        name: relatedTable,
        secondaryName: relationshipName,
        from,
        to,
        type: resolveRelationshipType(relationship),
        relatedTable
      }
    ];
  });

  return relationshipItems.sort((left, right) => {
    const nameComparison = left.name.localeCompare(right.name, "zh-CN");
    if (nameComparison !== 0) {
      return nameComparison;
    }
    return left.id.localeCompare(right.id, "zh-CN");
  });
}

export function ModelingModelDrawer(props: {
  open: boolean;
  model: ModelingGraphModel | null;
  relationships: ModelingGraphRelationship[];
  onOpenChange: (open: boolean) => void;
  onSaveMetadata?: (input: SaveModelMetadataInput) => Promise<void> | void;
  onLoadPreview?: (input: {
    targetKind: "model";
    targetId: string;
    limit?: number;
  }) => Promise<PreviewResult>;
}) {
  const { open, model, relationships, onOpenChange, onSaveMetadata, onLoadPreview } = props;
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});
  const [expandedRelationships, setExpandedRelationships] = useState<Record<string, boolean>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColumns, setEditColumns] = useState<EditableColumnDraft[]>([]);
  const [editError, setEditError] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEffect(() => {
    setExpandedColumns({});
    setExpandedRelationships({});
    setPreviewData(null);
    setPreviewError("");
    setPreviewLoading(false);
    setEditDialogOpen(false);
    setEditError("");
    setEditSubmitting(false);
  }, [model?.id]);

  useEffect(() => {
    if (!open) {
      setEditDialogOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }
    const handleEsc = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      onOpenChange(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("keydown", handleEsc);
    };
  }, [onOpenChange, open]);

  const relationshipItems = useMemo(() => {
    if (!model) {
      return [];
    }
    return resolveModelRelationships(model, relationships);
  }, [model, relationships]);

  const editDirty = useMemo(() => {
    if (!model) {
      return false;
    }
    if (editDisplayName !== (model.displayName ?? "")) {
      return true;
    }
    if (editDescription !== (model.description ?? "")) {
      return true;
    }
    if (editColumns.length !== model.columns.length) {
      return true;
    }
    return editColumns.some((columnDraft, index) => {
      const column = model.columns[index];
      if (!column) {
        return true;
      }
      return (
        columnDraft.displayName !== (column.displayName ?? "") ||
        columnDraft.description !== (column.description ?? "")
      );
    });
  }, [editColumns, editDescription, editDisplayName, model]);

  const loadPreview = async (): Promise<void> => {
    if (!model || !onLoadPreview) {
      return;
    }
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const result = await onLoadPreview({
        targetKind: "model",
        targetId: model.id,
        limit: PREVIEW_LIMIT
      });
      setPreviewData(result);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Load preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleColumn = (columnKey: string): void => {
    setExpandedColumns((previous) => ({
      ...previous,
      [columnKey]: !previous[columnKey]
    }));
  };

  const openEditDialog = (): void => {
    if (!model) {
      return;
    }
    setEditDisplayName(model.displayName ?? "");
    setEditDescription(model.description ?? "");
    setEditColumns(
      model.columns.map((column) => ({
        name: column.name,
        dataType: column.dataType,
        isNullable: column.isNullable,
        isPrimaryKey: column.isPrimaryKey,
        displayName: column.displayName ?? "",
        description: column.description ?? ""
      }))
    );
    setEditError("");
    setEditSubmitting(false);
    setEditDialogOpen(true);
  };

  const updateDraftColumn = (
    index: number,
    key: "displayName" | "description",
    value: string
  ): void => {
    setEditColumns((previous) =>
      previous.map((column, columnIndex) =>
        columnIndex === index
          ? {
              ...column,
              [key]: value
            }
          : column
      )
    );
  };

  const submitMetadataUpdate = async (): Promise<void> => {
    if (!model || !onSaveMetadata) {
      return;
    }
    setEditSubmitting(true);
    setEditError("");
    try {
      await onSaveMetadata({
        modelId: model.id,
        displayName: normalizeNullableText(editDisplayName),
        description: normalizeNullableText(editDescription),
        columns: editColumns.map((column, index) => ({
          index,
          displayName: normalizeNullableText(column.displayName),
          description: normalizeNullableText(column.description)
        }))
      });
      setEditDialogOpen(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "更新 metadata 失败，请稍后重试。");
    } finally {
      setEditSubmitting(false);
    }
  };

  const toggleRelationship = (relationshipId: string): void => {
    setExpandedRelationships((previous) => ({
      ...previous,
      [relationshipId]: !previous[relationshipId]
    }));
  };

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/5 backdrop-blur-[1px]"
          aria-label="Close model details overlay"
          onClick={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 w-full max-w-[760px] border-l border-[var(--border-default)] bg-[var(--surface-panel,#fff)] shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
        role="dialog"
        aria-modal="false"
        aria-label="Model details"
        data-testid="modeling-model-details-drawer"
      >
        <div className="flex h-full flex-col">
          <header className="border-b border-[var(--border-default)] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-lg font-semibold text-[var(--text-primary)]">
                  {model?.displayName?.trim() || model?.modelName || model?.tableName || "Model"}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">Model details</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!model || !onSaveMetadata}
                  onClick={openEditDialog}
                >
                  <Pencil className="h-4 w-4" />
                  编辑 metadata
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    onOpenChange(false);
                  }}
                  aria-label="Close model details"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </header>

          {model ? (
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
              <section className="rounded-lg border border-[var(--border-default)] bg-white px-4 py-3 shadow-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                      Name
                    </p>
                    <p className="text-sm text-[var(--text-primary)]">{model.tableName}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                      Alias
                    </p>
                    <p className="text-sm text-[var(--text-primary)]">
                      {model.displayName?.trim() || model.modelName}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-1 border-t border-[var(--border-default)] pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    Description
                  </p>
                  <p className="text-sm leading-6 text-[var(--text-primary)]">
                    {normalizeText(model.description)}
                  </p>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    Columns ({model.columns.length})
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Click +/- to show description
                  </p>
                </div>
                <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-white">
                  <div className="max-h-[320px] overflow-auto">
                    <Table className="min-w-[700px]">
                      <TableHeader className="sticky top-0 z-10 bg-[var(--surface-subtle)]/95 backdrop-blur-xs">
                        <TableRow>
                          <TableHead className="h-10 w-12 px-2" />
                          <TableHead className="h-10">Name</TableHead>
                          <TableHead className="h-10">Alias</TableHead>
                          <TableHead className="h-10">Type</TableHead>
                          <TableHead className="h-10">Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {model.columns.map((column, index) => {
                          const columnKey = `${column.name}:${index}`;
                          const description = normalizeText(column.description);
                          const expanded = Boolean(expandedColumns[columnKey]);
                          return (
                            <Fragment key={columnKey}>
                              <TableRow aria-expanded={expanded}>
                                <TableCell className="px-2 py-1.5">
                                  <Button
                                    type="button"
                                    size="icon-xs"
                                    variant="ghost"
                                    onClick={() => {
                                      toggleColumn(columnKey);
                                    }}
                                    aria-expanded={expanded}
                                    aria-label={`${expanded ? "Collapse" : "Expand"} column ${column.name}`}
                                  >
                                    {expanded ? (
                                      <Minus className="h-3.5 w-3.5" />
                                    ) : (
                                      <Plus className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TableCell>
                                <TableCell className="py-2 font-medium">{column.name}</TableCell>
                                <TableCell className="py-2 text-[var(--text-secondary)]">
                                  {column.displayName?.trim() || column.name}
                                </TableCell>
                                <TableCell className="py-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span>{column.dataType}</span>
                                    {column.isPrimaryKey ? (
                                      <Badge
                                        variant="outline"
                                        className="h-4 border-blue-200 bg-blue-50 px-1.5 text-[10px] text-blue-700"
                                      >
                                        PK
                                      </Badge>
                                    ) : null}
                                    <Badge
                                      variant={column.isNullable ? "secondary" : "outline"}
                                      className={cn(
                                        "h-4 px-1.5 text-[10px]",
                                        column.isNullable
                                          ? "bg-amber-100 text-amber-700"
                                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      )}
                                    >
                                      {column.isNullable ? "Nullable" : "Not null"}
                                    </Badge>
                                  </div>
                                </TableCell>
                                <TableCell
                                  className="max-w-[240px] truncate py-2 text-[var(--text-secondary)]"
                                  title={description}
                                >
                                  {truncateText(description, 46)}
                                </TableCell>
                              </TableRow>
                              {expanded ? (
                                <TableRow>
                                  <TableCell />
                                  <TableCell
                                    colSpan={4}
                                    className="bg-[var(--surface-subtle)] py-2 text-xs leading-6 text-[var(--text-secondary)]"
                                  >
                                    Description: {description}
                                  </TableCell>
                                </TableRow>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Relationships ({relationshipItems.length})
                </p>
                <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-white">
                  <div className="max-h-[260px] overflow-auto">
                    <Table className="min-w-[700px]">
                      <TableHeader className="sticky top-0 z-10 bg-[var(--surface-subtle)]/95 backdrop-blur-xs">
                        <TableRow>
                          <TableHead className="h-10 w-12 px-2" />
                          <TableHead className="h-10">Name</TableHead>
                          <TableHead className="h-10">Related model</TableHead>
                          <TableHead className="h-10">From</TableHead>
                          <TableHead className="h-10">To</TableHead>
                          <TableHead className="h-10">Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {relationshipItems.length > 0 ? (
                          relationshipItems.map((relationship) => {
                            const expanded = Boolean(expandedRelationships[relationship.id]);
                            return (
                              <Fragment key={relationship.id}>
                                <TableRow aria-expanded={expanded}>
                                  <TableCell className="px-2 py-1.5">
                                    <Button
                                      type="button"
                                      size="icon-xs"
                                      variant="ghost"
                                      onClick={() => {
                                        toggleRelationship(relationship.id);
                                      }}
                                      aria-expanded={expanded}
                                      aria-label={`${expanded ? "Collapse" : "Expand"} relationship ${relationship.name}`}
                                    >
                                      {expanded ? (
                                        <Minus className="h-3.5 w-3.5" />
                                      ) : (
                                        <Plus className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </TableCell>
                                  <TableCell className="py-2 font-medium">
                                    <div className="flex flex-col">
                                      <span>{relationship.name}</span>
                                      {relationship.secondaryName ? (
                                        <span
                                          className="truncate text-[10px] font-normal text-[var(--text-secondary)]"
                                          title={relationship.secondaryName}
                                        >
                                          {relationship.secondaryName}
                                        </span>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Badge
                                      variant="outline"
                                      className="h-4 border-slate-200 bg-slate-50 px-1.5 text-[10px] text-slate-700"
                                    >
                                      {relationship.relatedTable}
                                    </Badge>
                                  </TableCell>
                                  <TableCell
                                    className="max-w-[150px] truncate py-2 font-mono text-[11px] text-[var(--text-secondary)]"
                                    title={relationship.from}
                                  >
                                    {truncateText(relationship.from, 34)}
                                  </TableCell>
                                  <TableCell
                                    className="max-w-[150px] truncate py-2 font-mono text-[11px] text-[var(--text-secondary)]"
                                    title={relationship.to}
                                  >
                                    {truncateText(relationship.to, 34)}
                                  </TableCell>
                                  <TableCell className="py-2 text-[var(--text-secondary)]">
                                    {resolveRelationshipLabel(relationship.type)}
                                  </TableCell>
                                </TableRow>
                                {expanded ? (
                                  <TableRow>
                                    <TableCell />
                                    <TableCell
                                      colSpan={5}
                                      className="bg-[var(--surface-subtle)] py-2 text-xs leading-6 text-[var(--text-secondary)]"
                                    >
                                      Related table: {relationship.relatedTable} | From:{" "}
                                      {relationship.from} | To: {relationship.to}
                                      {relationship.secondaryName
                                        ? ` | Relationship: ${relationship.secondaryName}`
                                        : ""}
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            );
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={6} className="py-3 text-sm text-[var(--text-secondary)]">
                              No relationships for this model.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    Data preview
                    {previewData ? ` (${previewData.rowCount} rows)` : ""}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void loadPreview();
                    }}
                    disabled={previewLoading || !onLoadPreview}
                  >
                    {previewLoading ? "Loading..." : `View ${PREVIEW_LIMIT} rows`}
                  </Button>
                </div>

                {previewError ? <StateBlock variant="error">{previewError}</StateBlock> : null}

                {previewData ? (
                  previewData.columns.length === 0 || previewData.rows.length === 0 ? (
                    <StateBlock variant="idle">No preview rows available.</StateBlock>
                  ) : (
                    <div className="space-y-2">
                      {previewData.truncated ? (
                        <p className="text-xs text-[var(--text-secondary)]">
                          Showing first {PREVIEW_LIMIT} rows.
                        </p>
                      ) : null}
                      <div className="max-h-[320px] overflow-auto rounded-lg border border-[var(--border-default)] bg-white">
                        <Table className="min-w-[700px] text-xs">
                          <TableHeader className="sticky top-0 z-10 bg-[var(--surface-subtle)]/95 backdrop-blur-xs">
                            <TableRow>
                              {previewData.columns.map((column) => (
                                <TableHead key={column} className="h-9">
                                  {column}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewData.rows.map((row, index) => (
                              <TableRow key={`preview-row-${index}`}>
                                {previewData.columns.map((column) => (
                                  <TableCell
                                    key={`${index}:${column}`}
                                    className="max-w-[180px] truncate py-2 align-top font-mono text-[11px] text-[var(--text-primary)]"
                                    title={formatCell(row[column])}
                                  >
                                    {formatCell(row[column])}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )
                ) : null}
              </section>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <StateBlock variant="idle">Select a model node to inspect details.</StateBlock>
            </div>
          )}
        </div>
      </aside>

      <Dialog
        open={editDialogOpen}
        onOpenChange={(nextOpen) => {
          if (editSubmitting) {
            return;
          }
          setEditDialogOpen(nextOpen);
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-[var(--border-default)] px-5 py-4">
            <DialogTitle>Edit metadata</DialogTitle>
            <DialogDescription>
              更新当前 model 的业务别名与字段描述，保存后需再点击「保存 Modeling Draft」提交。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-5 py-4">
            <section className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    Name
                  </p>
                  <Input value={model?.tableName ?? ""} readOnly disabled aria-label="Model name" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                    Alias
                  </p>
                  <Input
                    value={editDisplayName}
                    onChange={(event) => {
                      setEditDisplayName(event.target.value);
                    }}
                    placeholder="输入模型别名"
                    aria-label="Model alias"
                    disabled={!model || editSubmitting}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                  Description
                </p>
                <Textarea
                  value={editDescription}
                  onChange={(event) => {
                    setEditDescription(event.target.value);
                  }}
                  placeholder="输入模型描述"
                  aria-label="Model description"
                  rows={3}
                  disabled={!model || editSubmitting}
                />
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Columns ({editColumns.length})
              </p>
              <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-white">
                <div className="max-h-[360px] overflow-auto">
                  <Table className="min-w-[780px]">
                    <TableHeader className="sticky top-0 z-10 bg-[var(--surface-subtle)]/95 backdrop-blur-xs">
                      <TableRow>
                        <TableHead className="h-10">Name</TableHead>
                        <TableHead className="h-10">Alias</TableHead>
                        <TableHead className="h-10">Type</TableHead>
                        <TableHead className="h-10">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editColumns.map((column, index) => (
                        <TableRow key={`${column.name}:${index}`}>
                          <TableCell className="py-2 font-medium">{column.name}</TableCell>
                          <TableCell className="py-1.5">
                            <Input
                              value={column.displayName}
                              onChange={(event) => {
                                updateDraftColumn(index, "displayName", event.target.value);
                              }}
                              placeholder={column.name}
                              aria-label={`${column.name} alias`}
                              disabled={editSubmitting}
                            />
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span>{column.dataType}</span>
                              {column.isPrimaryKey ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 border-blue-200 bg-blue-50 px-1.5 text-[10px] text-blue-700"
                                >
                                  PK
                                </Badge>
                              ) : null}
                              <Badge
                                variant={column.isNullable ? "secondary" : "outline"}
                                className={cn(
                                  "h-4 px-1.5 text-[10px]",
                                  column.isNullable
                                    ? "bg-amber-100 text-amber-700"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                )}
                              >
                                {column.isNullable ? "Nullable" : "Not null"}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Input
                              value={column.description}
                              onChange={(event) => {
                                updateDraftColumn(index, "description", event.target.value);
                              }}
                              placeholder="输入字段描述"
                              aria-label={`${column.name} description`}
                              disabled={editSubmitting}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Relationships ({relationshipItems.length})
              </p>
              <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-white">
                <div className="max-h-[220px] overflow-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader className="sticky top-0 z-10 bg-[var(--surface-subtle)]/95 backdrop-blur-xs">
                      <TableRow>
                        <TableHead className="h-10">Name</TableHead>
                        <TableHead className="h-10">From</TableHead>
                        <TableHead className="h-10">To</TableHead>
                        <TableHead className="h-10">Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {relationshipItems.length > 0 ? (
                        relationshipItems.map((relationship) => (
                          <TableRow key={`dialog-relationship-${relationship.id}`}>
                            <TableCell className="py-2 font-medium">
                              <div className="flex flex-col">
                                <span>{relationship.name}</span>
                                {relationship.secondaryName ? (
                                  <span
                                    className="truncate text-[10px] font-normal text-[var(--text-secondary)]"
                                    title={relationship.secondaryName}
                                  >
                                    {relationship.secondaryName}
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[180px] truncate py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                              {relationship.from}
                            </TableCell>
                            <TableCell className="max-w-[180px] truncate py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                              {relationship.to}
                            </TableCell>
                            <TableCell className="py-2 text-[var(--text-secondary)]">
                              {resolveRelationshipLabel(relationship.type)}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={4} className="py-3 text-sm text-[var(--text-secondary)]">
                            No relationships for this model.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </section>
            {editError ? <StateBlock variant="error">{editError}</StateBlock> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditDialogOpen(false);
              }}
              disabled={editSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void submitMetadataUpdate();
              }}
              disabled={!model || !onSaveMetadata || !editDirty || editSubmitting}
            >
              {editSubmitting ? "Saving..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
