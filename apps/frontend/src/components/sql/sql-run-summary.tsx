import type { SqlRun } from "@text2sql/shared-types";
import { StateBlock } from "@/components/ui/state-block";

interface SqlRunSummaryProps {
  run: SqlRun;
}

export function SqlRunSummary({ run }: SqlRunSummaryProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-semibold">状态：</span>
        <span className="ml-1">{run.status}</span>
      </p>
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">解释：</span>
        <span className="ml-1">{run.explanation ?? "-"}</span>
      </p>
      {run.error ? <StateBlock variant="error">{run.error}</StateBlock> : null}
    </div>
  );
}
