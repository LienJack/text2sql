"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ModelingGraphCalculatedField,
  ModelingGraphModel
} from "@text2sql/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";

type CalculatedFieldForm = {
  id: string;
  name: string;
  expression: string;
  dataType: string;
};

type ExpressionErrorCategory = "syntax" | "type" | "ref" | "not-supported";
type FunctionGroupHint = {
  id: "aggregate" | "math" | "string";
  label: string;
  examples: string[];
};
type ExpressionValidationErrorDetails = {
  category?: string;
  reason?: string;
  functionName?: string;
  supportedFunctionGroups?: Record<string, unknown>;
};

const FUNCTION_GROUP_HINTS: FunctionGroupHint[] = [
  {
    id: "aggregate",
    label: "聚合函数",
    examples: ["sum(expr)", "avg(expr)", "min(expr)", "max(expr)", "count(expr)"]
  },
  {
    id: "math",
    label: "数学函数",
    examples: ["abs(x)", "round(x, digits)", "coalesce(a, b, ...)", "nullif(a, b)"]
  },
  {
    id: "string",
    label: "字符串函数",
    examples: ["lower(text)", "upper(text)", "length(text)", "concat(a, b, ...)"]
  }
];

const EXPRESSION_ERROR_CATEGORY_LABEL: Record<ExpressionErrorCategory, string> = {
  syntax: "语法错误",
  type: "类型不匹配",
  ref: "字段引用错误",
  "not-supported": "函数或语法不支持"
};

function toForm(field?: ModelingGraphCalculatedField): CalculatedFieldForm {
  return {
    id: field?.id ?? "",
    name: field?.name ?? "",
    expression: field?.expression ?? "",
    dataType: field?.dataType ?? ""
  };
}

function nextFieldId(modelId: string, name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "calculated_field";
  return `${modelId}.${base}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFunctionGroupHints(value: unknown): string {
  if (!isRecord(value)) {
    return FUNCTION_GROUP_HINTS
      .map((group) => `${group.label}(${group.examples.join(", ")})`)
      .join("；");
  }

  const grouped = Object.entries(value)
    .map(([groupId, items]) => {
      if (!Array.isArray(items)) {
        return null;
      }
      const normalizedItems = items
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
      if (normalizedItems.length === 0) {
        return null;
      }
      const fallbackLabel = groupId;
      const label = FUNCTION_GROUP_HINTS.find((group) => group.id === groupId)?.label ?? fallbackLabel;
      return `${label}(${normalizedItems.join(", ")})`;
    })
    .filter((item): item is string => Boolean(item));

  if (grouped.length > 0) {
    return grouped.join("；");
  }

  return FUNCTION_GROUP_HINTS
    .map((group) => `${group.label}(${group.examples.join(", ")})`)
    .join("；");
}

function resolveCalculatedFieldSaveError(error: unknown): string {
  if (!isRecord(error)) {
    if (error instanceof Error) {
      return error.message || "保存 Calculated Fields 失败";
    }
    return "保存 Calculated Fields 失败";
  }

  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "保存 Calculated Fields 失败";
  if (code !== "WORKSPACE_MODELING_GRAPH_CALCULATED_FIELD_EXPRESSION_INVALID") {
    return message;
  }

  const details: ExpressionValidationErrorDetails = isRecord(error.details) ? error.details : {};
  const category = details.category as ExpressionErrorCategory | undefined;
  const categoryLabel = category ? EXPRESSION_ERROR_CATEGORY_LABEL[category] : "表达式错误";
  const reason = typeof details.reason === "string" ? details.reason : "";

  if (category === "not-supported") {
    const unsupportedFunction =
      typeof details.functionName === "string" && details.functionName.trim()
        ? `（${details.functionName.trim()}）`
        : "";
    const groupedHints = normalizeFunctionGroupHints(details.supportedFunctionGroups);
    return `表达式函数不在支持清单中${unsupportedFunction}。${reason || "请改用允许的表达式函数。"} 可用函数：${groupedHints}`;
  }

  if (reason) {
    return `${categoryLabel}：${reason}`;
  }

  return message;
}

export function ModelingCalculatedFieldEditor(props: {
  model: ModelingGraphModel | null;
  calculatedFields: ModelingGraphCalculatedField[];
  busy?: boolean;
  onSave: (fields: ModelingGraphCalculatedField[]) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { model, calculatedFields, busy, onSave, onDirtyChange } = props;
  const modelFields = useMemo(
    () =>
      calculatedFields.filter((field) => field.modelId === model?.id),
    [calculatedFields, model?.id]
  );

  const [workingFields, setWorkingFields] = useState<ModelingGraphCalculatedField[]>(modelFields);
  const [form, setForm] = useState<CalculatedFieldForm>(toForm());
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setWorkingFields(modelFields);
    setForm(toForm());
    setEditingFieldId(null);
    setError("");
  }, [modelFields, model?.id]);

  const dirty = useMemo(
    () => JSON.stringify(workingFields) !== JSON.stringify(modelFields),
    [workingFields, modelFields]
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  if (!model) {
    return <StateBlock variant="idle">请选择 Model 后编辑 Calculated Fields。</StateBlock>;
  }

  const upsertField = (): void => {
    const name = form.name.trim();
    const expression = form.expression.trim();
    const dataType = form.dataType.trim() || "string";
    if (!name) {
      setError("计算字段名称不能为空。");
      return;
    }
    if (!expression) {
      setError("表达式不能为空。");
      return;
    }
    const fieldId = form.id.trim() || nextFieldId(model.id, name);
    const nextField: ModelingGraphCalculatedField = {
      id: fieldId,
      modelId: model.id,
      name,
      expression,
      dataType
    };
    setError("");
    setWorkingFields((previous) => {
      const existed = previous.some((item) => item.id === fieldId);
      if (existed) {
        return previous.map((item) => (item.id === fieldId ? nextField : item));
      }
      return [...previous, nextField];
    });
    setForm(toForm());
    setEditingFieldId(null);
  };

  const save = async (): Promise<void> => {
    setSubmitting(true);
    setError("");
    try {
      const untouched = calculatedFields.filter((field) => field.modelId !== model.id);
      await onSave([...untouched, ...workingFields]);
    } catch (saveError) {
      setError(resolveCalculatedFieldSaveError(saveError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Calculated Fields</p>
        <p className="text-xs text-[var(--text-secondary)]">
          当前 Model：{model.displayName?.trim() || model.modelName}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Input
          aria-label="计算字段名称"
          placeholder="例如 total_amount"
          value={form.name}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, name: event.target.value }));
          }}
        />
        <Textarea
          aria-label="表达式"
          placeholder="例如 sum(order_items.price)"
          value={form.expression}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, expression: event.target.value }));
          }}
        />
        <div
          className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-muted,#f8fafc)] px-3 py-2"
          data-testid="calculated-field-expression-function-groups"
        >
          <p className="text-xs font-semibold text-[var(--text-primary)]">可用函数清单</p>
          <div className="mt-1 space-y-1">
            {FUNCTION_GROUP_HINTS.map((group) => (
              <p key={group.id} className="text-xs text-[var(--text-secondary)]">
                {group.label}：{group.examples.join("、")}
              </p>
            ))}
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            字段引用支持当前模型列与已定义计算字段；跨模型时使用 `model.column`。
          </p>
        </div>
        <Input
          aria-label="数据类型"
          placeholder="例如 decimal"
          value={form.dataType}
          onChange={(event) => {
            setForm((previous) => ({ ...previous, dataType: event.target.value }));
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={upsertField}>
          {editingFieldId ? "更新计算字段" : "添加计算字段"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setForm(toForm());
            setEditingFieldId(null);
            setError("");
          }}
        >
          清空输入
        </Button>
      </div>

      <div className="space-y-2">
        {workingFields.length === 0 ? (
          <StateBlock variant="idle">尚未定义 Calculated Field。</StateBlock>
        ) : (
          workingFields.map((field) => (
            <div
              key={field.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-default)] bg-white p-3"
            >
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{field.name}</p>
                <p className="text-xs text-[var(--text-secondary)]">{field.expression}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`编辑计算字段 ${field.name}`}
                  onClick={() => {
                    setForm(toForm(field));
                    setEditingFieldId(field.id);
                    setError("");
                  }}
                >
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`删除计算字段 ${field.name}`}
                  onClick={() => {
                    setWorkingFields((previous) =>
                      previous.filter((item) => item.id !== field.id)
                    );
                  }}
                >
                  删除
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {error ? <StateBlock variant="error">{error}</StateBlock> : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={busy || submitting || !dirty}>
          保存计算字段
        </Button>
        <Button
          variant="outline"
          disabled={busy || submitting || !dirty}
          onClick={() => {
            setWorkingFields(modelFields);
            setForm(toForm());
            setEditingFieldId(null);
            setError("");
          }}
        >
          放弃改动
        </Button>
      </div>
    </div>
  );
}
