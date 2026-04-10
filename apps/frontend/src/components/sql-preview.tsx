"use client";

import type { SqlRun } from "@text2sql/shared-types";
import { SqlResultTable } from "@/components/sql/sql-result-table";
import { SqlRunSummary } from "@/components/sql/sql-run-summary";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";

interface Props {
  run: SqlRun | null;
}

export function SqlPreview({ run }: Props) {
  if (!run) {
    return (
      <Card className="h-full">
        <CardHeader>
          <SectionHeader title="SQL 解释与执行结果" description="发送消息后会显示 SQL 预览与结果摘要。" />
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            暂无 SQL 预览
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <SectionHeader title="SQL 解释与执行结果" description="展示当前执行状态、SQL 文本与结果样本。" />
      </CardHeader>
      <CardContent className="space-y-4">
        <SqlRunSummary run={run} />
        <pre className="max-h-48 overflow-auto rounded-md border bg-secondary/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
          {run.sql ?? "暂无 SQL"}
        </pre>
        <SqlResultTable run={run} />
      </CardContent>
    </Card>
  );
}
