"use client";

import { useEffect, useState } from "react";
import type { WorkspaceRelationshipEdge } from "@/lib/admin-api-client";
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

type EdgeEditorForm = {
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

const toForm = (edge?: WorkspaceRelationshipEdge): EdgeEditorForm => ({
  id: edge?.id ?? "",
  name: edge?.name ?? "",
  leftDataset: edge?.bridge.left.dataset ?? "",
  leftTable: edge?.bridge.left.table ?? "",
  leftColumn: edge?.bridge.left.column ?? "",
  rightDataset: edge?.bridge.right.dataset ?? "",
  rightTable: edge?.bridge.right.table ?? "",
  rightColumn: edge?.bridge.right.column ?? "",
  confidence: String(edge?.bridge.confidence ?? 0.8)
});

const nextEdgeId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `edge-${Date.now()}`;
};

const toEdge = (form: EdgeEditorForm): WorkspaceRelationshipEdge => ({
  id: form.id.trim() || nextEdgeId(),
  name: form.name.trim() || undefined,
  bridge: {
    left: {
      dataset: form.leftDataset.trim(),
      table: form.leftTable.trim().toLowerCase(),
      column: form.leftColumn.trim().toLowerCase()
    },
    right: {
      dataset: form.rightDataset.trim(),
      table: form.rightTable.trim().toLowerCase(),
      column: form.rightColumn.trim().toLowerCase()
    },
    operator: "eq",
    confidence: Math.max(0, Math.min(1, Number(form.confidence)))
  }
});

export function RelationshipEdgeEditorDialog(props: {
  open: boolean;
  edge?: WorkspaceRelationshipEdge;
  onOpenChange: (open: boolean) => void;
  onSubmit: (edge: WorkspaceRelationshipEdge) => void;
}) {
  const [form, setForm] = useState<EdgeEditorForm>(toForm(props.edge));

  useEffect(() => {
    setForm(toForm(props.edge));
  }, [props.edge, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.edge ? "编辑关系边" : "新增关系边"}</DialogTitle>
          <DialogDescription>
            v1 bridge 仅支持 `operator=eq`，并要求左右端点 dataset/table/column 完整。
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            aria-label="关系边 ID"
            placeholder="edge-orders-customers"
            value={form.id}
            onChange={(event) => {
              setForm((previous) => ({ ...previous, id: event.target.value }));
            }}
          />
          <Input
            aria-label="关系边名称"
            placeholder="orders_to_customers"
            value={form.name}
            onChange={(event) => {
              setForm((previous) => ({ ...previous, name: event.target.value }));
            }}
          />
          <Input
            aria-label="左端 dataset"
            placeholder="sales"
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
            placeholder="crm"
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
            aria-label="可信度"
            placeholder="0.8"
            value={form.confidence}
            onChange={(event) => {
              setForm((previous) => ({ ...previous, confidence: event.target.value }));
            }}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              props.onOpenChange(false);
            }}
          >
            取消
          </Button>
          <Button
            onClick={() => {
              props.onSubmit(toEdge(form));
              props.onOpenChange(false);
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
