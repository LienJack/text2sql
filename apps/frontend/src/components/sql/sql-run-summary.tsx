import type { SqlRun } from "@text2sql/shared-types";
import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";

interface SqlRunSummaryProps {
  run: SqlRun;
}

export function SqlRunSummary({ run }: SqlRunSummaryProps) {
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
          className={run.status === "executionResult" ? "bg-teal-600 text-white" : ""}
        >
          {statusLabel}
        </Badge>
        <span className="text-xs text-slate-500">
          Provider: {run.provider}
          {run.model ? ` / ${run.model}` : ""}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">解释：</span>
        <span className="ml-1">{run.explanation ?? "-"}</span>
      </p>
      {run.error ? <StateBlock variant="error">{run.error}</StateBlock> : null}
    </div>
  );
}
