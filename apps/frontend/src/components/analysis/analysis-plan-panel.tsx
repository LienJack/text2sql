import type { AnalysisTaskReadModel } from "@text2sql/shared-types";
import { Check, Circle, GitBranch, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STAGES = [
  { key: "sql", label: "数据取证", artifacts: ["analysis.sql_evidence"] },
  { key: "research", label: "外部研究", artifacts: ["analysis.research_evidence"] },
  { key: "alignment", label: "证据对齐", artifacts: ["analysis.evidence_alignment"] },
  { key: "calculation", label: "确定性计算", artifacts: ["analysis.calculation", "analysis.claim"] },
  { key: "report", label: "报告投影", artifacts: ["analysis.report"] }
] as const;

export function AnalysisPlanPanel({ model }: { model: AnalysisTaskReadModel }) {
  const currentArtifacts = model.artifacts.filter(
    (artifact) => artifact.revisionId === model.currentRevision.id
  );
  return (
    <Card className="rounded-none border-stone-200 bg-white/80 py-0 ring-0">
      <CardHeader className="border-b border-stone-200 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 font-serif text-lg text-stone-950">
            <GitBranch className="size-4 text-blue-800" aria-hidden="true" />
            WorkGraph
          </CardTitle>
          <Badge variant="outline" className="font-mono">R{model.currentRevision.revision}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 px-4 py-4">
        {STAGES.map((stage, index) => {
          const completed = stage.artifacts.some((type) =>
            currentArtifacts.some(
              (artifact) => artifact.artifactType === type && artifact.status === "committed"
            )
          );
          return (
            <div key={stage.key} className="grid grid-cols-[24px_1fr_auto] items-center gap-2 py-2">
              <span className="flex size-5 items-center justify-center rounded-full border border-stone-300 bg-white text-[10px] font-semibold text-stone-600">
                {completed ? <Check className="size-3 text-emerald-700" aria-hidden="true" /> : index + 1}
              </span>
              <span className="text-sm font-medium text-stone-800">{stage.label}</span>
              <span className="text-xs text-stone-500">{completed ? "已提交" : "待处理"}</span>
            </div>
          );
        })}
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          <div className="flex items-center gap-1.5 font-semibold">
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            强制义务
          </div>
          <ul className="mt-2 space-y-1 text-amber-900">
            <li className="flex gap-2"><Circle className="mt-1 size-2 fill-current" />证据必须绑定来源与 digest</li>
            <li className="flex gap-2"><Circle className="mt-1 size-2 fill-current" />冲突不得静默消解</li>
            <li className="flex gap-2"><Circle className="mt-1 size-2 fill-current" />缺少真实 Outcome 时保持 HOLD</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
