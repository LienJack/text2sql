import type { SqlRun } from "@text2sql/shared-types";
import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";

interface SqlRunSummaryProps {
  run: SqlRun;
}

export function SqlRunSummary({ run }: SqlRunSummaryProps) {
  const rowCount = run.rows?.length ?? 0;
  const fieldCount = run.columns?.length ?? 0;
  const totalDuration = run.trace.steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  const statusLabel =
    run.status === "executionResult"
      ? "执行成功"
      : run.status === "clarification"
        ? "需要澄清"
        : run.status === "rejected"
          ? "已拒绝"
          : "执行失败";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge
          variant={run.status === "failed" ? "destructive" : "default"}
          className={run.status === "executionResult" ? "bg-primary text-primary-foreground" : ""}
        >
          {statusLabel}
        </Badge>
        <span className="text-xs text-[var(--text-tertiary)]">
          Provider: {run.provider}
          {run.model ? ` / ${run.model}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2.5 py-2">
          <p className="text-[var(--text-tertiary)]">行数</p>
          <p className="mt-1 font-semibold text-[var(--text-primary)]">{rowCount}</p>
        </div>
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2.5 py-2">
          <p className="text-[var(--text-tertiary)]">字段数</p>
          <p className="mt-1 font-semibold text-[var(--text-primary)]">{fieldCount}</p>
        </div>
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2.5 py-2">
          <p className="text-[var(--text-tertiary)]">耗时</p>
          <p className="mt-1 font-semibold text-[var(--text-primary)]">{totalDuration}ms</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">解释：</span>
        <span className="ml-1">{run.explanation ?? "-"}</span>
      </p>
      {run.error ? <StateBlock variant="error">{run.error}</StateBlock> : null}
    </div>
  );
}
