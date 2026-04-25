"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";

export interface ChatBISummaryMetric {
  key: string;
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "flat";
}

export interface ChatBISummaryData {
  text: string;
  headline?: string;
  metrics?: ChatBISummaryMetric[];
  dimensions?: string[];
}

interface ChatBISummaryProps {
  summary?: ChatBISummaryData;
  fallbackText?: string;
}

function formatMetricValue(value: string | number): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : "-";
  }
  return value;
}

function TrendIcon({ trend }: { trend?: ChatBISummaryMetric["trend"] }) {
  if (trend === "up") {
    return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  }
  if (trend === "down") {
    return <ArrowDownRight className="h-3.5 w-3.5 text-rose-600" aria-hidden />;
  }
  if (trend === "flat") {
    return <Minus className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden />;
  }
  return null;
}

export function ChatBISummary({ summary, fallbackText }: ChatBISummaryProps) {
  const text = summary?.text?.trim() || fallbackText?.trim();
  if (!text) {
    return <StateBlock variant="idle">暂无结构化摘要，已保留可核验结果分区。</StateBlock>;
  }

  const metrics = (summary?.metrics ?? []).filter(
    (item) => item && item.key && item.label
  );
  const dimensions = (summary?.dimensions ?? []).filter(
    (item) => typeof item === "string" && item.trim().length > 0
  );

  return (
    <section className="space-y-3" aria-label="Summary 结果分区">
      {summary?.headline ? (
        <p className="text-sm font-semibold text-[var(--text-primary)]">{summary.headline}</p>
      ) : null}
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
        {text}
      </p>

      {metrics.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {metrics.map((metric) => (
            <article
              key={metric.key}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] px-3 py-2"
            >
              <p className="text-xs text-[var(--text-secondary)]">{metric.label}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-base font-semibold text-[var(--text-primary)]">
                {formatMetricValue(metric.value)}
                {metric.unit ? (
                  <span className="text-xs font-normal text-[var(--text-secondary)]">{metric.unit}</span>
                ) : null}
                <TrendIcon trend={metric.trend} />
              </p>
            </article>
          ))}
        </div>
      ) : null}

      {dimensions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Summary 维度标签">
          {dimensions.map((dimension) => (
            <Badge key={dimension} variant="outline" className="text-[11px]">
              {dimension}
            </Badge>
          ))}
        </div>
      ) : null}
    </section>
  );
}
