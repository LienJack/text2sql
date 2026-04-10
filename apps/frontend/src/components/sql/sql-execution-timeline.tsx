"use client";

import type { ExecutionTraceStep } from "@text2sql/shared-types";
import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";

interface SqlExecutionTimelineProps {
  steps?: ExecutionTraceStep[];
}

function statusVariant(step: ExecutionTraceStep): "default" | "destructive" | "secondary" {
  if (step.status === "failed") {
    return "destructive";
  }
  if (step.status === "skipped") {
    return "secondary";
  }
  return "default";
}

export function SqlExecutionTimeline({ steps }: SqlExecutionTimelineProps) {
  if (!steps || steps.length === 0) {
    return <StateBlock variant="idle">暂无执行步骤。</StateBlock>;
  }

  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <details
          key={`${step.node}-${index}`}
          className="rounded-md border border-border px-3 py-2"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{step.node}</p>
              <p className="text-xs text-muted-foreground">{step.at}</p>
            </div>
            <div className="flex items-center gap-2">
              {step.durationMs !== undefined ? (
                <span className="text-xs text-muted-foreground">{step.durationMs}ms</span>
              ) : null}
              <Badge variant={statusVariant(step)}>{step.status}</Badge>
            </div>
          </summary>
          <div className="mt-2 space-y-2 text-xs text-muted-foreground">
            {step.detail ? <p>Detail: {step.detail}</p> : null}
            {step.inputSummary ? <p>Input: {step.inputSummary}</p> : null}
            {step.outputSummary ? <p>Output: {step.outputSummary}</p> : null}
            {step.errorSummary ? <p>Error: {step.errorSummary}</p> : null}
          </div>
        </details>
      ))}
    </div>
  );
}
