"use client";

import type { RagTaskConfig } from "@text2sql/shared-types";
import { Database, Orbit, RefreshCcwDot, Sparkles } from "lucide-react";
import type { RagFoundationSnapshot } from "@/lib/settings-api-client";
import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";

interface RagActiveIndexProfileCardProps {
  foundation: RagFoundationSnapshot | null;
  embeddingConfig: RagTaskConfig | null;
  rerankConfig?: RagTaskConfig | null;
}

function parseSourceVersionProfile(sourceVersion?: string): {
  provider?: string;
  model?: string;
  vectorVersion?: string;
} {
  if (!sourceVersion) {
    return {};
  }
  const parts = sourceVersion.split(":");
  if (parts.length < 6) {
    return {};
  }
  return {
    provider: parts[1]?.trim() || undefined,
    model: parts[2]?.trim() || undefined,
    vectorVersion: parts[3]?.trim() || undefined
  };
}

function computeReindexHint(input: {
  profile: {
    provider?: string;
    model?: string;
    vectorVersion?: string;
  };
  embeddingConfig: RagTaskConfig | null;
}): {
  reindexRequired: boolean;
  reasonCodes: string[];
} {
  const reasonCodes: string[] = [];
  const config = input.embeddingConfig;
  if (!config) {
    return {
      reindexRequired: false,
      reasonCodes: []
    };
  }
  if (input.profile.provider && config.provider !== input.profile.provider) {
    reasonCodes.push("provider_changed");
  }
  if (input.profile.model && config.model !== input.profile.model) {
    reasonCodes.push("model_changed");
  }
  if (
    input.profile.vectorVersion &&
    config.vectorVersion &&
    config.vectorVersion !== input.profile.vectorVersion
  ) {
    reasonCodes.push("vector_version_changed");
  }
  return {
    reindexRequired: reasonCodes.length > 0,
    reasonCodes
  };
}

export function RagActiveIndexProfileCard({
  foundation,
  embeddingConfig,
  rerankConfig = null
}: RagActiveIndexProfileCardProps) {
  const active = foundation?.activeIndexSummary.items[0];
  if (!active) {
    return <StateBlock variant="idle">暂无 active index profile。</StateBlock>;
  }

  const profile = parseSourceVersionProfile(active.sourceVersion);
  const reindexHint = computeReindexHint({
    profile,
    embeddingConfig
  });

  return (
    <section className="overflow-hidden rounded-3xl border border-[rgba(148,163,184,0.26)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.98)_55%,rgba(239,246,255,0.92)_100%)] shadow-[0_14px_32px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(37,99,235,0.1)] text-[var(--action-primary)]">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-[var(--text-tertiary)] uppercase">
                Active Index
              </p>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                当前检索索引画像
              </h3>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="bg-white/90">
              {active.indexVersionId}
            </Badge>
            <Badge
              variant={reindexHint.reindexRequired ? "destructive" : "outline"}
              className={!reindexHint.reindexRequired ? "bg-emerald-50 text-emerald-700" : ""}
            >
              {reindexHint.reindexRequired ? "需要重建索引" : "配置对齐"}
            </Badge>
            <Badge variant="outline" className="bg-white/90">
              datasource {active.datasourceId}
            </Badge>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            这里显示当前活跃索引的 embedding 画像，以及它与现行 RAG 配置是否一致。若 provider、
            model 或 vector version 不一致，下面会直接提示需要 reindex。
          </p>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:w-[32rem]">
          <div className="rounded-2xl border border-[rgba(148,163,184,0.22)] bg-white/86 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
              <Orbit className="h-3.5 w-3.5" />
              Embedding Index
            </div>
            <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
              {profile.provider ?? "unknown"}
            </p>
            <p className="mt-1 break-all text-sm text-[var(--text-secondary)]">
              {profile.model ?? "unknown"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              vectorVersion {profile.vectorVersion ?? "unknown"}
            </p>
          </div>
          <div className="rounded-2xl border border-[rgba(148,163,184,0.22)] bg-white/86 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              Runtime Config
            </div>
            <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
              {embeddingConfig
                ? `${embeddingConfig.provider} / ${embeddingConfig.model}`
                : "unknown"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              rerank{" "}
              {rerankConfig
                ? `${rerankConfig.provider} / ${rerankConfig.model}`
                : "unknown"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              activatedAt {active.activatedAt}
            </p>
          </div>
        </div>
      </div>
      <div className="border-t border-[rgba(148,163,184,0.16)] bg-white/55 px-5 py-4">
        {reindexHint.reindexRequired ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-rose-700">
            <RefreshCcwDot className="h-4 w-4" />
            <span className="font-medium">当前索引与运行配置不一致，需要重新构建索引。</span>
            <span className="text-xs text-rose-600">
              {reindexHint.reasonCodes.join(" / ")}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-700">
            <Sparkles className="h-4 w-4" />
            <span className="font-medium">索引画像与当前 Embedding 配置一致，可直接继续运行。</span>
          </div>
        )}
      </div>
    </section>
  );
}
