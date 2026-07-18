import type { AnalysisTaskReadModel } from "@text2sql/shared-types";
import { Activity, DatabaseZap, FileStack, Search } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export function AnalysisProgressPanel({ model }: { model: AnalysisTaskReadModel }) {
  const committed = model.artifacts.filter((artifact) => artifact.status === "committed");
  const expectedStages = 5;
  const completedStages = new Set(
    committed.map((artifact) => artifact.artifactType).filter((type) =>
      ["analysis.sql_evidence", "analysis.research_evidence", "analysis.evidence_alignment", "analysis.calculation", "analysis.report"].includes(type)
    )
  ).size;
  const percent = Math.min(100, Math.round((completedStages / expectedStages) * 100));
  const queryEvents = model.events.filter((event) => event.type.includes("query"));
  const searchEvents = model.events.filter((event) => event.type.includes("search"));
  return (
    <section className="border-y border-stone-200 bg-[#faf7ef] px-4 py-4" aria-label="分析进度与预算">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-stone-600 uppercase">
            <Activity className="size-3.5" aria-hidden="true" />真实进度
          </p>
          <p className="mt-1 font-serif text-2xl font-semibold text-stone-950">{percent}%</p>
        </div>
        <p className="text-xs text-stone-500">{completedStages}/{expectedStages} 关键阶段</p>
      </div>
      <Progress className="mt-3 h-1.5 bg-stone-200 [&_[data-slot=progress-indicator]]:bg-blue-800" value={percent} aria-label={`分析完成 ${percent}%`} />
      <div className="mt-4 grid grid-cols-3 divide-x divide-stone-200 text-center">
        <div><DatabaseZap className="mx-auto size-3.5 text-stone-500" /><p className="mt-1 font-mono text-sm font-semibold">{queryEvents.length}/{model.currentRevision.goalContract.budget.maxQueryCount}</p><p className="text-[10px] text-stone-500">查询</p></div>
        <div><Search className="mx-auto size-3.5 text-stone-500" /><p className="mt-1 font-mono text-sm font-semibold">{searchEvents.length}/{model.currentRevision.goalContract.budget.maxSearchCount}</p><p className="text-[10px] text-stone-500">搜索</p></div>
        <div><FileStack className="mx-auto size-3.5 text-stone-500" /><p className="mt-1 font-mono text-sm font-semibold">{committed.length}</p><p className="text-[10px] text-stone-500">Artifact</p></div>
      </div>
    </section>
  );
}
