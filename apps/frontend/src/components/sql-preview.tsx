"use client";

import type { SqlRun } from "@text2sql/shared-types";
import { Terminal, X } from "lucide-react";
import { SqlDebugDetails } from "@/components/sql/sql-debug-details";
import { SqlExecutionTimeline } from "@/components/sql/sql-execution-timeline";
import { SqlResultTable } from "@/components/sql/sql-result-table";
import { SqlRunSummary } from "@/components/sql/sql-run-summary";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

interface Props {
  run: SqlRun | null;
  debugEnabled: boolean;
  onClose?: () => void;
}

export function SqlPreview({ run, debugEnabled, onClose }: Props) {
  return (
    <div className="flex h-full flex-col bg-slate-50/60">
      <div className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Terminal className="h-4 w-4 text-teal-600" />
          执行结果与详情
        </h3>
        {onClose ? (
          <Button type="button" variant="ghost" size="icon-sm" className="lg:hidden" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!run ? (
          <StateBlock variant="idle">暂无 SQL 预览</StateBlock>
        ) : (
          <>
            <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">执行摘要</h4>
              <SqlRunSummary run={run} />
            </section>

            <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs text-slate-400">SQL</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  复制
                </Button>
              </div>
              <pre className="max-h-48 overflow-auto text-xs leading-relaxed whitespace-pre-wrap text-teal-50">
                {run.sql ?? "暂无 SQL"}
              </pre>
            </section>

            <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">执行步骤时间线</h4>
              <SqlExecutionTimeline steps={run.trace.steps} />
            </section>

            <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">调试详情</h4>
              {debugEnabled ? (
                <SqlDebugDetails run={run} />
              ) : (
                <StateBlock variant="idle">调试详情已关闭。</StateBlock>
              )}
            </section>

            <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">结果预览</h4>
              <SqlResultTable run={run} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
