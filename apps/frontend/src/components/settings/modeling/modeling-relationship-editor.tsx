"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelingGraphRelationship } from "@text2sql/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";

type RelationshipForm = {
  id: string;
  name: string;
  leftDataset: string;
  leftTable: string;
  leftColumn: string;
  rightDataset: string;
  rightTable: string;
  rightColumn: string;
  confidence: string;
};

function toForm(relationship?: ModelingGraphRelationship): RelationshipForm {
  return {
    id: relationship?.id ?? "",
    name: relationship?.name ?? "",
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

export function ModelingRelationshipEditor(props: {
  relationships: ModelingGraphRelationship[];
  selectedRelationshipId?: string | null;
  busy?: boolean;
  onSave: (relationships: ModelingGraphRelationship[]) => Promise<void> | void;
  onSelectRelationship?: (relationshipId: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { relationships, selectedRelationshipId, busy, onSave, onSelectRelationship, onDirtyChange } = props;
  const [workingRelationships, setWorkingRelationships] = useState(relationships);
  const [form, setForm] = useState<RelationshipForm>(toForm());
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setWorkingRelationships(relationships);
    setForm(toForm());
    setEditingRelationshipId(null);
    setError("");
  }, [relationships]);

  useEffect(() => {
    if (!selectedRelationshipId) {
      return;
    }
    const matchedRelationship = relationships.find((item) => item.id === selectedRelationshipId);
    if (!matchedRelationship) {
      return;
    }
    setForm(toForm(matchedRelationship));
    setEditingRelationshipId(matchedRelationship.id);
  }, [relationships, selectedRelationshipId]);

  const dirty = useMemo(
    () => JSON.stringify(workingRelationships) !== JSON.stringify(relationships),
    [relationships, workingRelationships]
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const upsertRelationship = (): void => {
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
    setWorkingRelationships((previous) => {
      const existed = previous.some((item) => item.id === relationship.id);
      if (existed) {
        return previous.map((item) => (item.id === relationship.id ? relationship : item));
      }
      return [...previous, relationship];
    });
    setForm(toForm());
    setEditingRelationshipId(null);
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

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Relationship Editor</p>
        <p className="text-xs text-[var(--text-secondary)]">
          在 Modeling Workspace 维护手工关系边，后续由 deploy 生效。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          aria-label="关系 ID"
          placeholder="可留空自动生成"
          value={form.id}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, id: event.target.value }));
          }}
        />
        <Input
          aria-label="关系名称"
          placeholder="orders_to_customers"
          value={form.name}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, name: event.target.value }));
          }}
        />
        <Input
          aria-label="左端 dataset"
          placeholder="analytics"
          value={form.leftDataset}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, leftDataset: event.target.value }));
          }}
        />
        <Input
          aria-label="左端 table"
          placeholder="orders"
          value={form.leftTable}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, leftTable: event.target.value }));
          }}
        />
        <Input
          aria-label="左端 column"
          placeholder="customer_id"
          value={form.leftColumn}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, leftColumn: event.target.value }));
          }}
        />
        <Input
          aria-label="右端 dataset"
          placeholder="analytics"
          value={form.rightDataset}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, rightDataset: event.target.value }));
          }}
        />
        <Input
          aria-label="右端 table"
          placeholder="customers"
          value={form.rightTable}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, rightTable: event.target.value }));
          }}
        />
        <Input
          aria-label="右端 column"
          placeholder="id"
          value={form.rightColumn}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, rightColumn: event.target.value }));
          }}
        />
        <Input
          aria-label="关系可信度"
          placeholder="0.8"
          value={form.confidence}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, confidence: event.target.value }));
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={upsertRelationship}>
          {editingRelationshipId ? "更新关系" : "添加关系"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setForm(toForm());
            setEditingRelationshipId(null);
            setError("");
          }}
        >
          清空输入
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
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`编辑关系 ${relationship.id}`}
                  onClick={() => {
                    setForm(toForm(relationship));
                    setEditingRelationshipId(relationship.id);
                    onSelectRelationship?.(relationship.id);
                    setError("");
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
  );
}
