"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@/components/ui/chart";
import { StateBlock } from "@/components/ui/state-block";
import type { ChatBIResultTableData } from "@/components/chat/chatbi-result-table";

export type ChatBIChartType = "metric" | "bar" | "line" | "pie";

type ChartMappingKey =
  | "dimension"
  | "time"
  | "x"
  | "y"
  | "measure"
  | "value"
  | "label"
  | "series";

export interface ChatBICanonicalChart {
  type: ChatBIChartType;
  mappings: Partial<Record<ChartMappingKey, string>>;
  meta?: {
    title?: string;
    subtitle?: string;
    unit?: string;
    xLabel?: string;
    yLabel?: string;
  };
}

interface ChatBIChartProps {
  chart?: ChatBICanonicalChart;
  table?: ChatBIResultTableData;
  fallbackReason?: string;
}

const PIE_COLORS = [
  "#0ea5e9",
  "#34d399",
  "#f59e0b",
  "#f43f5e",
  "#6366f1",
  "#14b8a6"
] as const;

function readNumericValue(value: unknown): number | undefined {
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

function readStringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function pickMapping(
  mappings: ChatBICanonicalChart["mappings"],
  keys: ChartMappingKey[]
): string | undefined {
  for (const key of keys) {
    const candidate = mappings[key];
    if (candidate && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function renderFallback(reason: string) {
  return <StateBlock variant="idle">图表不可用，已降级为表格：{reason}</StateBlock>;
}

function MetricChart({
  chart,
  table
}: {
  chart: ChatBICanonicalChart;
  table: ChatBIResultTableData;
}) {
  const valueKey = pickMapping(chart.mappings, ["value", "measure", "y"]);
  const labelKey = pickMapping(chart.mappings, ["label", "dimension", "x", "time"]);
  if (!valueKey) {
    return renderFallback("缺少 value/measure 字段映射");
  }

  const firstRow = table.rowsPreview[0];
  const metricValue = firstRow ? readNumericValue(firstRow[valueKey]) : undefined;
  if (metricValue === undefined) {
    return renderFallback("指标值为空或非数字");
  }

  const metricLabel =
    (labelKey && firstRow ? readStringValue(firstRow[labelKey]) : undefined) ??
    chart.meta?.title ??
    "指标";

  return (
    <article
      className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] px-4 py-3"
      data-testid="chatbi-metric-card"
    >
      <p className="text-xs text-[var(--text-secondary)]">{metricLabel}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
        {metricValue.toLocaleString()}
        {chart.meta?.unit ? (
          <span className="ml-1 text-sm font-normal text-[var(--text-secondary)]">
            {chart.meta.unit}
          </span>
        ) : null}
      </p>
      {chart.meta?.subtitle ? (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{chart.meta.subtitle}</p>
      ) : null}
    </article>
  );
}

function BarOrLineChart({
  chart,
  table,
  mode
}: {
  chart: ChatBICanonicalChart;
  table: ChatBIResultTableData;
  mode: "bar" | "line";
}) {
  const xKey = pickMapping(chart.mappings, ["x", "dimension", "time", "label"]);
  const yKey = pickMapping(chart.mappings, ["y", "measure", "value"]);
  if (!xKey || !yKey) {
    return renderFallback("缺少 x/y 字段映射");
  }

  const data = table.rowsPreview
    .map((row) => {
      const label = readStringValue(row[xKey]);
      const value = readNumericValue(row[yKey]);
      if (!label || value === undefined) {
        return undefined;
      }
      return {
        label,
        value
      };
    })
    .filter((item): item is { label: string; value: number } => Boolean(item));

  if (data.length === 0) {
    return renderFallback("图表字段无可用数据");
  }

  return (
    <div className="space-y-2" data-testid={`chatbi-${mode}-chart`}>
      <ChartContainer
        config={{
          value: {
            label: chart.meta?.yLabel ?? "数值",
            color: "#0ea5e9"
          }
        }}
        className="h-[240px] w-full"
        initialDimension={{
          width: 640,
          height: 240
        }}
        data-testid="chatbi-chart-canvas"
      >
        {mode === "bar" ? (
          <BarChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 12 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={48} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Bar dataKey="value" fill="var(--color-value)" radius={[8, 8, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 12 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={48} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Line
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        )}
      </ChartContainer>
      {chart.meta?.subtitle ? (
        <p className="text-xs text-[var(--text-secondary)]">{chart.meta.subtitle}</p>
      ) : null}
    </div>
  );
}

function PieResultChart({
  chart,
  table
}: {
  chart: ChatBICanonicalChart;
  table: ChatBIResultTableData;
}) {
  const labelKey = pickMapping(chart.mappings, ["label", "dimension", "x", "time"]);
  const valueKey = pickMapping(chart.mappings, ["value", "measure", "y"]);
  if (!labelKey || !valueKey) {
    return renderFallback("缺少 label/value 字段映射");
  }

  const data = table.rowsPreview
    .map((row) => {
      const name = readStringValue(row[labelKey]);
      const value = readNumericValue(row[valueKey]);
      if (!name || value === undefined) {
        return undefined;
      }
      return {
        name,
        value
      };
    })
    .filter((item): item is { name: string; value: number } => Boolean(item));

  if (data.length === 0) {
    return renderFallback("图表字段无可用数据");
  }

  return (
    <div className="space-y-2" data-testid="chatbi-pie-chart">
      <ChartContainer
        config={{
          value: {
            label: chart.meta?.unit ?? "数值",
            color: "#0ea5e9"
          }
        }}
        className="h-[240px] w-full"
        initialDimension={{
          width: 640,
          height: 240
        }}
        data-testid="chatbi-chart-canvas"
      >
        <PieChart>
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={84}
            label
          >
            {data.map((entry, index) => (
              <Cell
                key={`${entry.name}-${index}`}
                fill={PIE_COLORS[index % PIE_COLORS.length]}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      {chart.meta?.subtitle ? (
        <p className="text-xs text-[var(--text-secondary)]">{chart.meta.subtitle}</p>
      ) : null}
    </div>
  );
}

export function ChatBIChart({ chart, table, fallbackReason }: ChatBIChartProps) {
  if (fallbackReason) {
    return renderFallback(fallbackReason);
  }
  if (!chart) {
    return <StateBlock variant="idle">暂无可渲染图表，已提供表格结果。</StateBlock>;
  }
  if (!table || table.rowsPreview.length === 0) {
    return <StateBlock variant="idle">图表数据为空，已提供表格结果。</StateBlock>;
  }

  if (chart.meta?.title) {
    const title = (
      <p className="text-xs font-medium text-[var(--text-secondary)]">{chart.meta.title}</p>
    );

    if (chart.type === "metric") {
      return (
        <div className="space-y-2">
          {title}
          <MetricChart chart={chart} table={table} />
        </div>
      );
    }
    if (chart.type === "bar") {
      return (
        <div className="space-y-2">
          {title}
          <BarOrLineChart chart={chart} table={table} mode="bar" />
        </div>
      );
    }
    if (chart.type === "line") {
      return (
        <div className="space-y-2">
          {title}
          <BarOrLineChart chart={chart} table={table} mode="line" />
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {title}
        <PieResultChart chart={chart} table={table} />
      </div>
    );
  }

  if (chart.type === "metric") {
    return <MetricChart chart={chart} table={table} />;
  }
  if (chart.type === "bar") {
    return <BarOrLineChart chart={chart} table={table} mode="bar" />;
  }
  if (chart.type === "line") {
    return <BarOrLineChart chart={chart} table={table} mode="line" />;
  }
  return <PieResultChart chart={chart} table={table} />;
}
