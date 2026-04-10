"use client";

import type { SqlRun } from "@text2sql/shared-types";
import { StateBlock } from "@/components/ui/state-block";

interface SqlDebugDetailsProps {
  run: SqlRun | null;
}

export function SqlDebugDetails({ run }: SqlDebugDetailsProps) {
  if (!run) {
    return <StateBlock variant="idle">暂无调试信息。</StateBlock>;
  }

  if (!run.llmRaw) {
    return <StateBlock variant="idle">该会话无历史原始返回数据。</StateBlock>;
  }

  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">
        Provider: {run.llmRaw.provider} / Model: {run.llmRaw.model}
      </p>
      <p className="text-xs text-muted-foreground">CreatedAt: {run.llmRaw.createdAt}</p>
      <pre className="max-h-40 overflow-auto rounded-md bg-secondary/30 p-2 text-xs whitespace-pre-wrap">
        {run.llmRaw.rawText}
      </pre>
    </div>
  );
}
