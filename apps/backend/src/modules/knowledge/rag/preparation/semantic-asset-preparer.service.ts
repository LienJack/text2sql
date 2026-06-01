import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  type SemanticAssetEmbeddingProfile,
  type SemanticAssetFamily,
  type SemanticAssetManifest,
  type SemanticAssetManifestSummary,
  type SemanticAssetPreparationTrigger
} from "./semantic-asset-manifest.types";
import { SemanticAssetManifestBuilder } from "./semantic-asset-manifest.builder";
import { SEMANTIC_ASSET_REASON_CODES } from "./semantic-asset-reason-codes";
import { SemanticAssetFamilyChunkMapper } from "./semantic-asset-family-chunk.mapper";
import type { IngestionSourceInput } from "../../../rag/ingestion/ingestion-source.adapter";
import type {
  SemanticAssetExcludedSourceSnapshot,
  SemanticAssetSourceSnapshot
} from "./semantic-asset-source-snapshot.types";

export interface PrepareSemanticAssetsInput {
  datasourceId: string;
  workspaceId?: string;
  embeddingProfile: SemanticAssetEmbeddingProfile;
  sourceVersion?: string;
  sourceHash?: string;
  modelingRevision?: number;
  triggers?: readonly SemanticAssetPreparationTrigger[];
  reasonCodes?: readonly string[];
  sourceSnapshots?: readonly SemanticAssetSourceSnapshot[];
}

export interface SemanticAssetPreparationResult {
  manifest: SemanticAssetManifest;
  manifestSummary: SemanticAssetManifestSummary;
  sourceSnapshots: SemanticAssetSourceSnapshot[];
  excludedSnapshots: SemanticAssetExcludedSourceSnapshot[];
  ingestionSources: IngestionSourceInput[];
}

@Injectable()
export class SemanticAssetPreparerService {
  constructor(
    private readonly manifestBuilder: SemanticAssetManifestBuilder,
    private readonly chunkMapper: SemanticAssetFamilyChunkMapper
  ) {}

  prepare(input: PrepareSemanticAssetsInput): SemanticAssetPreparationResult {
    const normalizedSnapshots = (input.sourceSnapshots ?? []).map((snapshot) =>
      this.normalizeSnapshot(input, snapshot)
    );
    const excludedSnapshots = this.excludedSnapshots(normalizedSnapshots);
    const durableSnapshots = normalizedSnapshots.filter(
      (snapshot) => !this.isExcludedCorrectionFeedback(snapshot)
    );
    const triggers =
      input.triggers && input.triggers.length > 0
        ? [...input.triggers]
        : this.unique(durableSnapshots.map((snapshot) => this.triggerForSnapshot(snapshot)));
    const manifest = this.manifestBuilder.build({
      datasourceId: input.datasourceId,
      workspaceId: input.workspaceId,
      triggers,
      embeddingProfile: input.embeddingProfile,
      sourceVersion: input.sourceVersion,
      sourceHash: input.sourceHash,
      modelingRevision: input.modelingRevision,
      reasonCodes: input.reasonCodes,
      sourceSnapshots: this.groupSnapshotsByTrigger(durableSnapshots)
    });
    const snapshotsByEntry = this.snapshotsByEntryKey(durableSnapshots);
    const ingestionSources = manifest.entries
      .filter((entry) => entry.status === "prepared")
      .map((entry) => {
        const snapshot = snapshotsByEntry.get(this.entryKeyFromParts(entry.family, entry.sourceRef.ref));
        return snapshot
          ? this.chunkMapper.toIngestionSource({
              manifestFingerprint: manifest.fingerprint,
              entry,
              snapshot
            })
          : undefined;
      })
      .filter((item): item is IngestionSourceInput => Boolean(item));

    return {
      manifest,
      manifestSummary: this.manifestBuilder.summarize(manifest),
      sourceSnapshots: durableSnapshots,
      excludedSnapshots,
      ingestionSources
    };
  }

  private normalizeSnapshot(
    input: PrepareSemanticAssetsInput,
    snapshot: SemanticAssetSourceSnapshot
  ): SemanticAssetSourceSnapshot {
    const family = snapshot.family ?? this.familyForSourceKind(snapshot);
    const sourceRef = snapshot.sourceRef ?? {
      type: snapshot.sourceKind ?? this.sourceRefTypeForFamily(family),
      ref:
        snapshot.viewId ??
        snapshot.term ??
        snapshot.tableName ??
        snapshot.title ??
        `${family}:${this.digest(snapshot).slice(0, 12)}`
    };
    const trigger = snapshot.trigger ?? this.triggerForFamily(family);
    const reasonCodes = [...(snapshot.reasonCodes ?? [])];
    let status = snapshot.status;
    let enabled = snapshot.enabled;

    if (snapshot.runtimeEligible === false) {
      enabled = false;
      reasonCodes.push(SEMANTIC_ASSET_REASON_CODES.skippedDisabled);
    }
    if (this.isInactiveGlossaryTerm(snapshot)) {
      enabled = false;
      reasonCodes.push(SEMANTIC_ASSET_REASON_CODES.skippedDisabled);
    }
    if (family === "relationship_binding" && !this.hasRelationshipPayload(snapshot)) {
      status = "degraded";
      reasonCodes.push(SEMANTIC_ASSET_REASON_CODES.degradedMissingRelationshipPayload);
    }
    if (this.requiresModelingRevision(family) && !snapshot.modelingRevision && !input.modelingRevision) {
      status = "degraded";
      reasonCodes.push(SEMANTIC_ASSET_REASON_CODES.degradedMissingModelingRevision);
    }

    return {
      ...snapshot,
      trigger,
      family,
      sourceRef,
      sourceVersion: snapshot.sourceVersion ?? `${sourceRef.type}:${sourceRef.ref}:latest`,
      sourceHash: snapshot.sourceHash,
      workspaceId: snapshot.workspaceId ?? input.workspaceId,
      datasourceId: snapshot.datasourceId ?? input.datasourceId,
      modelingRevision: snapshot.modelingRevision ?? input.modelingRevision,
      visibilityScope: snapshot.visibilityScope ?? this.visibilityScopeForFamily(family),
      enabled,
      status,
      reasonCodes: this.unique(reasonCodes)
    };
  }

  private groupSnapshotsByTrigger(
    snapshots: readonly SemanticAssetSourceSnapshot[]
  ): Partial<
    Record<SemanticAssetPreparationTrigger, readonly SemanticAssetSourceSnapshot[]>
  > {
    return snapshots.reduce<
      Partial<Record<SemanticAssetPreparationTrigger, SemanticAssetSourceSnapshot[]>>
    >((acc, snapshot) => {
      const trigger = this.triggerForSnapshot(snapshot);
      acc[trigger] = [...(acc[trigger] ?? []), snapshot];
      return acc;
    }, {});
  }

  private snapshotsByEntryKey(
    snapshots: readonly SemanticAssetSourceSnapshot[]
  ): Map<string, SemanticAssetSourceSnapshot> {
    const result = new Map<string, SemanticAssetSourceSnapshot>();
    for (const snapshot of snapshots) {
      if (!snapshot.family || !snapshot.sourceRef) {
        continue;
      }
      result.set(this.entryKeyFromParts(snapshot.family, snapshot.sourceRef.ref), snapshot);
    }
    return result;
  }

  private excludedSnapshots(
    snapshots: readonly SemanticAssetSourceSnapshot[]
  ): SemanticAssetExcludedSourceSnapshot[] {
    return snapshots
      .filter((snapshot) => this.isExcludedCorrectionFeedback(snapshot))
      .map((snapshot) => ({
        snapshot,
        reasonCodes: [SEMANTIC_ASSET_REASON_CODES.skippedCorrectionNotPromoted]
      }));
  }

  private isExcludedCorrectionFeedback(snapshot: SemanticAssetSourceSnapshot): boolean {
    return snapshot.sourceKind === "correction_feedback" && snapshot.promoted !== true;
  }

  private isInactiveGlossaryTerm(snapshot: SemanticAssetSourceSnapshot): boolean {
    return (
      (snapshot.family === "business_term" || snapshot.sourceKind === "glossary_term") &&
      snapshot.summary?.status === "inactive"
    );
  }

  private hasRelationshipPayload(snapshot: SemanticAssetSourceSnapshot): boolean {
    return (
      Boolean(snapshot.content?.trim()) ||
      Boolean(snapshot.relationships && snapshot.relationships.length > 0)
    );
  }

  private requiresModelingRevision(family: SemanticAssetFamily): boolean {
    return family === "relationship_binding" || family === "metric" || family === "calculated_field";
  }

  private familyForSourceKind(snapshot: SemanticAssetSourceSnapshot): SemanticAssetFamily {
    switch (snapshot.sourceKind) {
      case "glossary_term":
        return "business_term";
      case "prompt_instruction":
        return "prompt_instruction";
      case "saved_prior_sql":
        return "prior_question_sql";
      case "dialect_metadata":
        return "dialect_rule";
      case "project_metadata":
        return "project_metadata";
      case "modeling_graph":
        return "relationship_binding";
      case "datasource_schema":
      case undefined:
        return snapshot.columns && snapshot.columns.length > 0
          ? "column_batch"
          : "table_description";
      case "correction_feedback":
        return "prior_question_sql";
      default: {
        const exhaustive: never = snapshot.sourceKind;
        return exhaustive;
      }
    }
  }

  private triggerForSnapshot(snapshot: SemanticAssetSourceSnapshot): SemanticAssetPreparationTrigger {
    return snapshot.trigger ?? this.triggerForFamily(snapshot.family ?? this.familyForSourceKind(snapshot));
  }

  private triggerForFamily(family: SemanticAssetFamily): SemanticAssetPreparationTrigger {
    if (family === "prompt_instruction") {
      return "instructions";
    }
    if (family === "prior_question_sql") {
      return "prior_sql";
    }
    if (family === "relationship_binding" || family === "metric" || family === "calculated_field") {
      return "modeling_revision";
    }
    if (family === "project_metadata") {
      return "embedding_model";
    }
    return "schema";
  }

  private sourceRefTypeForFamily(family: SemanticAssetFamily): string {
    if (family === "business_term") {
      return "glossary_term";
    }
    if (family === "prior_question_sql") {
      return "saved_prior_sql";
    }
    if (family === "prompt_instruction") {
      return "prompt_instruction";
    }
    if (family === "relationship_binding" || family === "metric" || family === "calculated_field") {
      return "modeling_graph";
    }
    if (family === "dialect_rule") {
      return "dialect_metadata";
    }
    if (family === "project_metadata") {
      return "project_metadata";
    }
    return "datasource_schema";
  }

  private visibilityScopeForFamily(family: SemanticAssetFamily): "workspace" | "datasource" | "table_permissions" | "public" {
    if (family === "prior_question_sql" || family === "prompt_instruction") {
      return "workspace";
    }
    if (family === "business_term") {
      return "workspace";
    }
    return "datasource";
  }

  private entryKeyFromParts(family: SemanticAssetFamily, ref: string): string {
    return `${family}|${ref}`;
  }

  private unique<T extends string>(values: readonly (T | undefined)[]): T[] {
    return Array.from(new Set(values.filter((item): item is T => Boolean(item?.trim()))));
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(stableStringify(value)).digest("hex");
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
