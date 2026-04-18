"use client";

import { useEffect, useState } from "react";
import type { DeliveryContract, SqlRun } from "@text2sql/shared-types";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { RagDeliveryPanel } from "@/components/chat/rag-delivery-panel";
import { RagFoundationStatusCard } from "@/components/chat/rag-foundation-status-card";
import { SqlDebugDetails } from "@/components/sql/sql-debug-details";
import { SqlExecutionTimeline } from "@/components/sql/sql-execution-timeline";
import { SqlResultTable } from "@/components/sql/sql-result-table";
import { SqlRunSummary } from "@/components/sql/sql-run-summary";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import {
  extractRagFoundationSnapshot,
  fetchBackendHealthSnapshot,
  type RagFoundationSnapshot
} from "@/lib/settings-api-client";
import { cn } from "@/lib/utils";

interface SqlInlinePanelProps {
  run: SqlRun | null;
  streamDelivery?: DeliveryContract;
  debugEnabled: boolean;
  openSignal?: number;
  highlight?: boolean;
}

export function SqlInlinePanel({
  run,
  streamDelivery,
  debugEnabled,
  openSignal = 0,
  highlight = false
}: SqlInlinePanelProps) {
  const [open, setOpen] = useState(false);
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [foundationError, setFoundationError] = useState("");
  const [foundationSnapshot, setFoundationSnapshot] =
    useState<RagFoundationSnapshot | null>(null);

  useEffect(() => {
    if (openSignal > 0) {
      setOpen(true);
    }
  }, [openSignal]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let disposed = false;
    setFoundationLoading(true);
    setFoundationError("");

    void fetchBackendHealthSnapshot()
      .then((snapshot) => {
        if (disposed) {
          return;
        }
        setFoundationSnapshot(extractRagFoundationSnapshot(snapshot));
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        setFoundationSnapshot(null);
        setFoundationError(error instanceof Error ? error.message : "health 请求失败");
      })
      .finally(() => {
        if (disposed) {
          return;
        }
        setFoundationLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [open]);

  if (!run) {
    if (!streamDelivery) {
      return null;
    }
  }

  const delivery = run?.delivery ?? streamDelivery;

  return (
    <section
      className={cn(
        "mt-3 rounded-xl border bg-[var(--surface-subtle)]",
        highlight ? "border-[var(--border-brand)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]" : "border-[var(--border-default)]"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <Terminal className="h-3.5 w-3.5 text-[var(--action-primary)]" />
          运行详情
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-label={open ? "收起 SQL 详情" : "展开 SQL 详情"}
          className="h-7 text-xs text-[var(--text-secondary)]"
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? (
            <>
              收起
              <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              展开
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>

      {open ? (
        <div className="space-y-3 border-t border-[var(--border-default)] px-3 py-3">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            兼容旧称：SQL 执行详情
          </p>
          <section className="space-y-2 rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-panel)] p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              Foundation 状态摘要
            </h4>
            <RagFoundationStatusCard
              foundation={foundationSnapshot}
              loading={foundationLoading}
              error={foundationError}
              compact
            />
          </section>

          <section className="space-y-2 rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-panel)] p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              RAG 证据
            </h4>
            <RagDeliveryPanel delivery={delivery} runId={run?.runId} />
          </section>

          <section className="space-y-2 rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-panel)] p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">执行摘要</h4>
            {run ? (
              <SqlRunSummary run={run} />
            ) : (
              <StateBlock variant="idle">运行详情回填中，请稍候...</StateBlock>
            )}
          </section>

          <section className="space-y-2 rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs text-[var(--text-tertiary)]">SQL</p>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-active)] hover:text-[var(--action-primary-hover)]"
                onClick={() => {
                  if (run?.sql) {
                    void navigator.clipboard.writeText(run.sql);
                  }
                }}
              >
                复制
              </Button>
            </div>
            <pre className="max-h-48 overflow-auto text-xs leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
              {run?.sql ?? "暂无 SQL"}
            </pre>
          </section>

          <section className="space-y-2 rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-panel)] p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              执行步骤时间线
            </h4>
            <SqlExecutionTimeline steps={run?.trace.steps} />
          </section>

          <section className="space-y-2 rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-panel)] p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">调试详情</h4>
            {debugEnabled ? (
              <SqlDebugDetails run={run ?? null} />
            ) : (
              <StateBlock variant="idle">调试详情已关闭。</StateBlock>
            )}
          </section>

          <section className="space-y-2 rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-panel)] p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">结果预览</h4>
            {run ? (
              <SqlResultTable run={run} />
            ) : (
              <StateBlock variant="idle">结果预览将在运行详情回填后展示。</StateBlock>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
