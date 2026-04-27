"use client";

import type { RagTaskConfig } from "@text2sql/shared-types";
import type { RagFoundationSnapshot } from "@/lib/settings-api-client";
import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";

interface RagActiveIndexProfileCardProps {
  foundation: RagFoundationSnapshot | null;
  embeddingConfig: RagTaskConfig | null;
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
  embeddingConfig
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
    <section className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Active Index Profile</h3>
        <Badge variant="outline">{active.indexVersionId}</Badge>
        <Badge variant={reindexHint.reindexRequired ? "destructive" : "outline"}>
          {reindexHint.reindexRequired ? "reindex required" : "aligned"}
        </Badge>
      </div>
      <div className="space-y-1 text-xs text-[var(--text-secondary)]">
        <p>provider: {profile.provider ?? "unknown"}</p>
        <p>model: {profile.model ?? "unknown"}</p>
        <p>vectorVersion: {profile.vectorVersion ?? "unknown"}</p>
        <p>activatedAt: {active.activatedAt}</p>
        <p>datasourceId: {active.datasourceId}</p>
      </div>
      {reindexHint.reindexRequired ? (
        <StateBlock variant="error">
          reindexRequired=true · {reindexHint.reasonCodes.join(", ")}
        </StateBlock>
      ) : (
        <StateBlock variant="success">reindexRequired=false</StateBlock>
      )}
    </section>
  );
}
