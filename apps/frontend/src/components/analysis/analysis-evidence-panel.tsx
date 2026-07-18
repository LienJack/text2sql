import type { AnalysisArtifactMetadata } from "@text2sql/shared-types";
import { Database, FileCheck2, Globe2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function sourceIcon(type: string) {
  if (type.includes("research")) return Globe2;
  if (type.includes("sql")) return Database;
  return FileCheck2;
}

export function AnalysisEvidencePanel({ artifacts }: { artifacts: AnalysisArtifactMetadata[] }) {
  const evidence = artifacts.filter(
    (artifact) =>
      artifact.visibility === "user" &&
      (artifact.artifactType.includes("evidence") || artifact.artifactType === "analysis.claim")
  );
  if (evidence.length === 0) {
    return <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">尚未提交可见证据。</p>;
  }
  return (
    <div className="space-y-3" aria-label="证据列表">
      {evidence.map((artifact) => {
        const Icon = sourceIcon(artifact.artifactType);
        return (
          <article key={artifact.id} className="border-l-2 border-blue-800 bg-white px-4 py-3 shadow-[0_1px_0_rgba(28,25,23,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <Icon className="mt-0.5 size-4 shrink-0 text-blue-800" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="break-all font-mono text-xs font-semibold text-stone-800">{artifact.artifactType}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-stone-500">{artifact.id}</p>
                </div>
              </div>
              <Badge variant="outline">{artifact.completeness}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
              <span className="flex items-center gap-1"><ShieldCheck className="size-3" />digest {artifact.payloadDigest.slice(0, 12)}</span>
              <span>{Math.max(1, Math.round(artifact.payloadSizeBytes / 1024))} KB</span>
              <span>{artifact.payloadAvailable ? "payload 可回放" : "payload 已过期"}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
