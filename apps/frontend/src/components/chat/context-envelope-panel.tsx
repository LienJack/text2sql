"use client";

import { useState } from "react";
import type { ContextEnvelope } from "@text2sql/shared-types";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ContextEnvelopeDraft {
  metricDefinition: string;
  timeRangeFrom: string;
  timeRangeTo: string;
  timezone: string;
  entityMappings: string;
  mustIncludeTables: string;
  mustExcludeTables: string;
  businessConstraints: string;
}

interface ContextEnvelopePanelProps {
  value: ContextEnvelopeDraft;
  clearAfterSend: boolean;
  disabled?: boolean;
  onValueChange: (next: ContextEnvelopeDraft) => void;
  onClearAfterSendChange: (next: boolean) => void;
}

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function splitByDelimiters(value: string, pattern: RegExp): string[] {
  return value
    .split(pattern)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseEntityMappings(value: string): Array<{ entity: string; mappedTo: string }> {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines
    .map((line) => {
      const separatorIndex = line.indexOf("=") >= 0 ? line.indexOf("=") : line.indexOf(":");
      if (separatorIndex <= 0 || separatorIndex >= line.length - 1) {
        return undefined;
      }
      const entity = line.slice(0, separatorIndex).trim();
      const mappedTo = line.slice(separatorIndex + 1).trim();
      if (!entity || !mappedTo) {
        return undefined;
      }
      return {
        entity,
        mappedTo
      };
    })
    .filter((item): item is { entity: string; mappedTo: string } => Boolean(item));
}

export function createEmptyContextEnvelopeDraft(): ContextEnvelopeDraft {
  return {
    metricDefinition: "",
    timeRangeFrom: "",
    timeRangeTo: "",
    timezone: "",
    entityMappings: "",
    mustIncludeTables: "",
    mustExcludeTables: "",
    businessConstraints: ""
  };
}

export function buildContextEnvelopeFromDraft(
  draft: ContextEnvelopeDraft
): ContextEnvelope | undefined {
  const metricDefinition = trimOrUndefined(draft.metricDefinition);
  const from = trimOrUndefined(draft.timeRangeFrom);
  const to = trimOrUndefined(draft.timeRangeTo);
  const timezone = trimOrUndefined(draft.timezone);
  const entityMappings = parseEntityMappings(draft.entityMappings);
  const mustIncludeTables = splitByDelimiters(draft.mustIncludeTables, /[,\n]/);
  const mustExcludeTables = splitByDelimiters(draft.mustExcludeTables, /[,\n]/);
  const businessConstraints = splitByDelimiters(
    draft.businessConstraints,
    /[;\n,；]/
  );

  const timeRange =
    from || to || timezone
      ? {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(timezone ? { timezone } : {})
        }
      : undefined;

  const contextEnvelope: ContextEnvelope = {
    ...(metricDefinition ? { metricDefinition } : {}),
    ...(timeRange ? { timeRange } : {}),
    ...(entityMappings.length > 0 ? { entityMappings } : {}),
    ...(mustIncludeTables.length > 0 ? { mustIncludeTables } : {}),
    ...(mustExcludeTables.length > 0 ? { mustExcludeTables } : {}),
    ...(businessConstraints.length > 0 ? { businessConstraints } : {})
  };

  return Object.keys(contextEnvelope).length > 0 ? contextEnvelope : undefined;
}

export function ContextEnvelopePanel({
  value,
  clearAfterSend,
  disabled = false,
  onValueChange,
  onClearAfterSendChange
}: ContextEnvelopePanelProps) {
  const [open, setOpen] = useState(false);

  const updateField = (field: keyof ContextEnvelopeDraft, nextValue: string) => {
    onValueChange({
      ...value,
      [field]: nextValue
    });
  };

  return (
    <section className="rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-subtle)]">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-between rounded-[12px] px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls="chat-context-envelope-panel"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {open ? "收起高级上下文" : "展开高级上下文"}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />
        )}
      </Button>

      {open ? (
        <div
          id="chat-context-envelope-panel"
          className="space-y-3 border-t border-[var(--border-default)] px-3 py-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="context-envelope-metric-definition">指标口径</Label>
            <Textarea
              id="context-envelope-metric-definition"
              aria-label="指标口径"
              value={value.metricDefinition}
              onChange={(event) => updateField("metricDefinition", event.target.value)}
              placeholder="例如：净销售额=订单金额-退款金额"
              rows={2}
              disabled={disabled}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="context-envelope-time-range-from">开始日期</Label>
              <Input
                id="context-envelope-time-range-from"
                aria-label="开始日期"
                type="date"
                value={value.timeRangeFrom}
                onChange={(event) => updateField("timeRangeFrom", event.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="context-envelope-time-range-to">结束日期</Label>
              <Input
                id="context-envelope-time-range-to"
                aria-label="结束日期"
                type="date"
                value={value.timeRangeTo}
                onChange={(event) => updateField("timeRangeTo", event.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="context-envelope-timezone">时区</Label>
              <Input
                id="context-envelope-timezone"
                aria-label="时区"
                value={value.timezone}
                onChange={(event) => updateField("timezone", event.target.value)}
                placeholder="Asia/Shanghai"
                disabled={disabled}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="context-envelope-entity-mappings">实体映射</Label>
            <Textarea
              id="context-envelope-entity-mappings"
              aria-label="实体映射"
              value={value.entityMappings}
              onChange={(event) => updateField("entityMappings", event.target.value)}
              placeholder="每行一个映射，例如：华北大区=region_north"
              rows={3}
              disabled={disabled}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="context-envelope-include-tables">强制包含表</Label>
              <Input
                id="context-envelope-include-tables"
                aria-label="强制包含表"
                value={value.mustIncludeTables}
                onChange={(event) => updateField("mustIncludeTables", event.target.value)}
                placeholder="orders, payments"
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="context-envelope-exclude-tables">强制排除表</Label>
              <Input
                id="context-envelope-exclude-tables"
                aria-label="强制排除表"
                value={value.mustExcludeTables}
                onChange={(event) => updateField("mustExcludeTables", event.target.value)}
                placeholder="internal_audit_logs"
                disabled={disabled}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="context-envelope-business-constraints">业务约束</Label>
            <Textarea
              id="context-envelope-business-constraints"
              aria-label="业务约束"
              value={value.businessConstraints}
              onChange={(event) => updateField("businessConstraints", event.target.value)}
              placeholder="用逗号、分号或换行分隔"
              rows={2}
              disabled={disabled}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Checkbox
              checked={clearAfterSend}
              onCheckedChange={(checked) => {
                onClearAfterSendChange(checked === true);
              }}
              aria-label="发送后清空上下文"
              disabled={disabled}
            />
            发送后清空高级上下文
          </label>
        </div>
      ) : null}
    </section>
  );
}
