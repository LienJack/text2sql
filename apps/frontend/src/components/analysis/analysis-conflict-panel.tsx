import type { AnalysisTaskReadModel } from "@text2sql/shared-types";
import { AlertTriangle, CircleSlash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function AnalysisConflictPanel({ model }: { model: AnalysisTaskReadModel }) {
  const conflicts = model.artifacts.filter(
    (artifact) => artifact.artifactType === "analysis.conflict_set"
  );
  const holds = model.receipts.filter(
    (receipt) => receipt.decision === "hold" || receipt.decision === "no_go"
  );
  if (conflicts.length === 0 && holds.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
        <p className="flex items-center gap-2 font-semibold"><CircleSlash2 className="size-4" />当前没有已登记冲突</p>
        <p className="mt-1 text-xs text-emerald-800">这不代表证据完整；仍以 Alignment 与 Manifest 为准。</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {conflicts.map((artifact) => (
        <article key={artifact.id} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-semibold text-amber-950"><AlertTriangle className="size-4" />冲突集</p>
            <Badge variant="outline" className="border-amber-400 text-amber-900">{artifact.completeness}</Badge>
          </div>
          <p className="mt-2 break-all font-mono text-[11px] text-amber-900">{artifact.id}</p>
          <p className="mt-2 text-xs text-amber-800">冲突被保留为独立 Artifact，报告不得静默选边。</p>
        </article>
      ))}
      {holds.map((receipt) => (
        <article key={receipt.id} className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-950">
          <div className="flex justify-between gap-2"><span className="font-semibold">{receipt.receiptType}</span><Badge variant="destructive">{receipt.decision}</Badge></div>
          <p className="mt-2 text-xs">{receipt.reasonCodes.join(" · ") || "未提供原因码"}</p>
        </article>
      ))}
    </div>
  );
}
