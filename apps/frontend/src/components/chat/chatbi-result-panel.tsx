"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DeliveryArtifactLayer,
  DeliveryContract,
  SqlRun
} from "@text2sql/shared-types";
import { AlertTriangle } from "lucide-react";
import { ChatBIChart, type ChatBICanonicalChart } from "@/components/chat/chatbi-chart";
import {
  ChatBIResultTable,
  type ChatBIResultTableData
} from "@/components/chat/chatbi-result-table";
import {
  ChatBIResultTabs,
  type ChatBIResultTabValue
} from "@/components/chat/chatbi-result-tabs";
import { ChatBISummary, type ChatBISummaryData } from "@/components/chat/chatbi-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { TabsContent } from "@/components/ui/tabs";

interface ChatBIResultPanelProps {
  run: SqlRun | null;
  streamDelivery?: DeliveryContract;
  runId?: string;
  openSqlSignal?: number;
}

type JsonRecord = Record<string, unknown>;

type DeliveryDisplayType =
  | "answer"
  | "summary"
  | "chart"
  | "table"
  | "sql"
  | "metric"
  | "bar"
  | "line"
  | "pie";

interface ChatBIFallbackMeta {
  reason: string;
  reasonCode?: string;
  fromType?: string;
}

interface ChatBIValidationMeta {
  status?: string;
  message?: string;
}

interface ChatBIArtifactView {
  summary?: ChatBISummaryData;
  table?: ChatBIResultTableData;
  chart?: ChatBICanonicalChart;
  sql?: string;
  fallback?: ChatBIFallbackMeta;
  validation?: ChatBIValidationMeta;
  displayType?: DeliveryDisplayType;
}

const DISPLAY_ALLOWLIST: ReadonlySet<DeliveryDisplayType> = new Set([
  "answer",
  "summary",
  "chart",
  "table",
  "sql",
  "metric",
  "bar",
  "line",
  "pie"
]);

const CHART_ALLOWLIST: ReadonlySet<ChatBICanonicalChart["type"]> = new Set([
  "metric",
  "bar",
  "line",
  "pie"
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is JsonRecord => isRecord(item));
}

function normalizeDisplayType(value: unknown): DeliveryDisplayType | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return DISPLAY_ALLOWLIST.has(normalized as DeliveryDisplayType)
    ? (normalized as DeliveryDisplayType)
    : undefined;
}

function normalizeSummary(value: unknown): ChatBISummaryData | undefined {
  if (typeof value === "string") {
    return value.trim() ? { text: value.trim() } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const text =
    readString(value.text) ??
    readString(value.summary) ??
    readString(value.description);
  const headline = readString(value.headline) ?? readString(value.title);

  const metrics = Array.isArray(value.metrics)
    ? value.metrics
        .map((item) => {
          if (!isRecord(item)) {
            return undefined;
          }
          const key = readString(item.key) ?? readString(item.label);
          const label = readString(item.label) ?? readString(item.key);
          const rawValue = item.value;
          const valueAsNumber = readNumber(rawValue);
          const valueAsString = readString(rawValue);
          if (!key || !label || (valueAsNumber === undefined && !valueAsString)) {
            return undefined;
          }
          const trendRaw = readString(item.trend)?.toLowerCase();
          const trend: "up" | "down" | "flat" | undefined =
            trendRaw === "up" || trendRaw === "down" || trendRaw === "flat"
              ? trendRaw
              : undefined;
          return {
            key,
            label,
            value: valueAsNumber ?? valueAsString!,
            unit: readString(item.unit),
            trend
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  const dimensions = readStringArray(value.dimensions);

  if (!text && !headline && metrics.length === 0 && dimensions.length === 0) {
    return undefined;
  }

  return {
    text: text ?? headline ?? "",
    ...(headline ? { headline } : {}),
    ...(metrics.length > 0 ? { metrics } : {}),
    ...(dimensions.length > 0 ? { dimensions } : {})
  };
}

function normalizeTable(value: unknown): ChatBIResultTableData | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const columns = readStringArray(value.columns);
  const rowsPreview = readRecordArray(value.rowsPreview);
  const rowCount = Math.max(0, Math.floor(readNumber(value.rowCount) ?? rowsPreview.length));
  const previewRowCountRaw = readNumber(value.previewRowCount) ?? readNumber(value.previewRows);
  const previewRowCount =
    previewRowCountRaw !== undefined ? Math.max(0, Math.floor(previewRowCountRaw)) : rowsPreview.length;
  const truncated = readBoolean(value.truncated) ?? previewRowCount < rowCount;

  if (columns.length === 0 && rowsPreview.length === 0) {
    return undefined;
  }

  return {
    columns,
    rowsPreview,
    rowCount,
    previewRowCount,
    truncated
  };
}

function normalizeChartMappings(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const normalized = Object.entries(value).reduce<Record<string, string>>(
    (acc, [key, mapping]) => {
      const next = readString(mapping);
      if (next) {
        acc[key] = next;
      }
      return acc;
    },
    {}
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeChart(value: unknown): ChatBICanonicalChart | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const typeRaw = readString(value.type)?.toLowerCase();
  if (!typeRaw || !CHART_ALLOWLIST.has(typeRaw as ChatBICanonicalChart["type"])) {
    return undefined;
  }

  const mappings = normalizeChartMappings(value.mappings);
  if (!mappings) {
    return undefined;
  }

  const metaRaw = isRecord(value.meta) ? value.meta : undefined;
  const meta = {
    title: readString(metaRaw?.title) ?? readString(value.title),
    subtitle: readString(metaRaw?.subtitle),
    unit: readString(metaRaw?.unit),
    xLabel: readString(metaRaw?.xLabel),
    yLabel: readString(metaRaw?.yLabel)
  };

  return {
    type: typeRaw as ChatBICanonicalChart["type"],
    mappings,
    meta: Object.values(meta).some((item) => Boolean(item)) ? meta : undefined
  };
}

function normalizeFallback(value: unknown): ChatBIFallbackMeta | undefined {
  if (typeof value === "string") {
    return value.trim() ? { reason: value.trim() } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const reason = readString(value.reason) ?? readString(value.message);
  if (!reason) {
    return undefined;
  }
  return {
    reason,
    reasonCode: readString(value.reasonCode) ?? readString(value.code),
    fromType: readString(value.fromType) ?? readString(value.from)
  };
}

function normalizeValidation(value: unknown): ChatBIValidationMeta | undefined {
  if (typeof value === "string") {
    return value.trim() ? { status: value.trim() } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const status = readString(value.status);
  const message =
    readString(value.message) ??
    (Array.isArray(value.errors) ? readString(value.errors[0]) : undefined);

  if (!status && !message) {
    return undefined;
  }

  return {
    ...(status ? { status } : {}),
    ...(message ? { message } : {})
  };
}

function normalizeArtifact(artifact: DeliveryArtifactLayer): ChatBIArtifactView {
  const record = artifact as DeliveryArtifactLayer & JsonRecord;

  const canonicalTable = normalizeTable(record.table);
  const legacyTable =
    canonicalTable ??
    (record.columns || record.rowsPreview
      ? {
          columns: readStringArray(record.columns),
          rowsPreview: readRecordArray(record.rowsPreview),
          rowCount: Math.max(
            0,
            Math.floor(readNumber(record.rowCount) ?? readRecordArray(record.rowsPreview).length)
          ),
          previewRowCount: readRecordArray(record.rowsPreview).length,
          truncated:
            readRecordArray(record.rowsPreview).length <
            Math.max(
              0,
              Math.floor(
                readNumber(record.rowCount) ?? readRecordArray(record.rowsPreview).length
              )
            )
        }
      : undefined);

  const displayType = normalizeDisplayType(record.display)
    ?? normalizeDisplayType((record.display as JsonRecord | undefined)?.type)
    ?? normalizeDisplayType((record.display as JsonRecord | undefined)?.displayType);

  return {
    summary: normalizeSummary(record.summary),
    table: legacyTable,
    chart: normalizeChart(record.chart),
    sql: readString(record.sql),
    fallback: normalizeFallback(record.fallback),
    validation: normalizeValidation(record.validation),
    displayType
  };
}

export function ChatBIResultPanel({
  run,
  streamDelivery,
  runId,
  openSqlSignal = 0
}: ChatBIResultPanelProps) {
  const delivery = run?.delivery ?? streamDelivery;
  const artifact = delivery?.artifact;

  const artifactView = useMemo(() => {
    if (!artifact) {
      return undefined;
    }
    return normalizeArtifact(artifact);
  }, [artifact]);

  const hasStructuredArtifact = Boolean(
    artifactView?.summary ||
      artifactView?.table ||
      artifactView?.chart ||
      artifactView?.fallback ||
      artifactView?.validation ||
      artifactView?.sql
  );

  const [activeTab, setActiveTab] = useState<ChatBIResultTabValue>("answer");
  const hasTableEvidence = Boolean(artifactView?.table);

  useEffect(() => {
    setActiveTab("answer");
  }, [runId]);

  useEffect(() => {
    if (openSqlSignal > 0) {
      setActiveTab("sql");
    }
  }, [openSqlSignal]);

  if (!artifactView || !hasStructuredArtifact) {
    return null;
  }

  const fallbackReason = artifactView.fallback?.reason;
  const forcedTableDisplay = artifactView.displayType === "table";
  const chartFallbackReason =
    fallbackReason ??
    (forcedTableDisplay ? "服务端已指定该结果以表格作为主展示。" : undefined);

  const summaryFallbackText = delivery?.answer.text;

  return (
    <section
      className="overflow-hidden rounded-xl border border-[var(--chat-result-panel-border)] bg-[var(--chat-result-panel-bg)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      data-testid="chatbi-result-panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2">
        <p className="text-xs font-semibold tracking-wider text-[var(--text-secondary)] uppercase">
          ChatBI Result
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {artifactView.validation?.status ? (
            <Badge variant="outline">validation: {artifactView.validation.status}</Badge>
          ) : null}
          {chartFallbackReason ? (
            <Badge variant="secondary" className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              已降级为表格
            </Badge>
          ) : null}
        </div>
      </header>

      <div className="space-y-3 p-3">
        <ChatBIResultTabs value={activeTab} onValueChange={setActiveTab}>
          <TabsContent value="answer" className="mt-0">
            <section className="space-y-3" aria-label="Answer partition">
              <ChatBISummary
                summary={artifactView.summary}
                fallbackText={summaryFallbackText}
              />
              {hasTableEvidence ? (
                <section
                  className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)] p-3"
                  aria-label="Table evidence"
                >
                  <h4 className="text-[11px] font-semibold tracking-wider text-[var(--text-tertiary)] uppercase">
                    Table evidence
                  </h4>
                  <ChatBIResultTable table={artifactView.table} />
                </section>
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="chart" className="mt-0" data-testid="chatbi-chart-tab-panel">
            {chartFallbackReason ? (
              <div className="space-y-2">
                <StateBlock variant="idle">图表已降级为表格：{chartFallbackReason}</StateBlock>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab("answer")}
                >
                  查看 Answer 分区中的表格证据
                </Button>
              </div>
            ) : (
              <ChatBIChart chart={artifactView.chart} table={artifactView.table} />
            )}
          </TabsContent>

          <TabsContent value="sql" className="mt-0">
            <section className="space-y-2" aria-label="View SQL partition">
              <p className="text-xs text-[var(--text-secondary)]">
                用于生成当前回答的 SQL 证据。
              </p>
              {artifactView.sql || run?.sql ? (
                <pre className="max-h-36 overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
                  {artifactView.sql ?? run?.sql}
                </pre>
              ) : (
                <StateBlock variant="idle">当前结果未返回 SQL 文本。</StateBlock>
              )}
            </section>
          </TabsContent>
        </ChatBIResultTabs>

        {artifactView.validation?.message ? (
          <p className="text-xs text-[var(--text-secondary)]">{artifactView.validation.message}</p>
        ) : null}
      </div>
    </section>
  );
}
