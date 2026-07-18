import type { AnalysisTaskReadModel } from "@text2sql/shared-types";
import { FileText, LockKeyhole, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function manifestClass(status: string): string {
  if (status === "GO") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "NO_GO" || status === "ROLLBACK") return "border-red-300 bg-red-50 text-red-900";
  return "border-amber-300 bg-amber-50 text-amber-950";
}

export function AnalysisReportPanel({ model }: { model: AnalysisTaskReadModel }) {
  const reports = model.artifacts.filter((artifact) => artifact.artifactType === "analysis.report");
  const manifests = [...model.manifests].sort((a, b) => b.sealedAt.localeCompare(a.sealedAt));
  return (
    <div className="space-y-4">
      <div className="border-b border-stone-200 pb-4">
        <p className="flex items-center gap-2 font-serif text-xl font-semibold text-stone-950"><FileText className="size-4 text-blue-800" />报告投影</p>
        <p className="mt-1 text-xs text-stone-500">界面只展示 Claim 派生的安全投影与发布清单，不渲染原始 HTML。</p>
      </div>
      {reports.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">报告尚未生成。</p>
      ) : (
        reports.map((report) => (
          <article key={report.id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs font-semibold text-stone-800">{report.id}</p>
              <Badge variant="outline">{report.completeness}</Badge>
            </div>
            <p className="mt-2 text-xs text-stone-500">schema {report.schemaVersion} · digest {report.payloadDigest.slice(0, 16)}</p>
          </article>
        ))
      )}
      <div className="space-y-3 pt-1">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-stone-600 uppercase"><LockKeyhole className="size-3.5" />Release Manifest</p>
        {manifests.length === 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="flex items-center gap-2 font-semibold"><ShieldQuestion className="size-4" />HOLD</p>
            <p className="mt-1 text-xs">尚无已封存 Manifest；不得推断为 GO。</p>
          </div>
        ) : manifests.map((manifest) => (
          <article key={manifest.id} className={`rounded-lg border p-4 ${manifestClass(manifest.status)}`}>
            <div className="flex items-center justify-between gap-3"><p className="font-semibold">{manifest.manifestType}</p><Badge variant="outline" className="border-current">{manifest.status}</Badge></div>
            <p className="mt-2 font-mono text-[10px] opacity-75">{manifest.digest.slice(0, 20)}</p>
            {manifest.limitations.length > 0 ? <ul className="mt-3 list-disc space-y-1 pl-4 text-xs">{manifest.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
