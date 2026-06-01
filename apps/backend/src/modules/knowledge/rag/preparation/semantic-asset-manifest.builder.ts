import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  SEMANTIC_ASSET_MANIFEST_VERSION,
  type SemanticAssetEmbeddingProfile,
  type SemanticAssetFamily,
  type SemanticAssetManifest,
  type SemanticAssetManifestEntry,
  type SemanticAssetManifestSummary,
  type SemanticAssetPreparationStatus,
  type SemanticAssetPreparationTrigger,
  type SemanticAssetSourceRef
} from "./semantic-asset-manifest.types";
import type { SemanticAssetSourceSnapshot } from "./semantic-asset-source-snapshot.types";
import {
  SEMANTIC_ASSET_REASON_CODES,
  type SemanticAssetReasonCode
} from "./semantic-asset-reason-codes";

export interface BuildSemanticAssetManifestInput {
  datasourceId: string;
  workspaceId?: string;
  triggers: readonly SemanticAssetPreparationTrigger[];
  embeddingProfile: SemanticAssetEmbeddingProfile;
  sourceVersion?: string;
  sourceHash?: string;
  modelingRevision?: number;
  reasonCodes?: readonly SemanticAssetReasonCode[];
  sourceSnapshots?: Partial<
    Record<
      SemanticAssetPreparationTrigger,
      SemanticAssetSourceSnapshot | readonly SemanticAssetSourceSnapshot[] | unknown
    >
  >;
}

@Injectable()
export class SemanticAssetManifestBuilder {
  build(input: BuildSemanticAssetManifestInput): SemanticAssetManifest {
    const triggers = this.unique(input.triggers).sort();
    const entries = triggers
      .flatMap((trigger) => this.buildEntriesForTrigger(input, trigger))
      .sort((left, right) => this.entrySortKey(left).localeCompare(this.entrySortKey(right)));
    const reasonCodes = this.unique([
      ...(input.reasonCodes ?? []),
      ...(triggers.length === 0 ? [SEMANTIC_ASSET_REASON_CODES.skippedNoTriggers] : []),
      ...entries.flatMap((entry) => entry.reasonCodes)
    ]);

    const manifestWithoutFingerprint = {
      manifestVersion: SEMANTIC_ASSET_MANIFEST_VERSION,
      datasourceId: input.datasourceId,
      workspaceId: input.workspaceId,
      embeddingProfile: input.embeddingProfile,
      sourceSnapshotSummary: {
        triggers,
        modelingRevision: input.modelingRevision,
        sourceVersion: input.sourceVersion,
        sourceHash: input.sourceHash
      },
      entries,
      familyCounts: this.countFamilies(entries),
      reasonCodes
    };

    return {
      ...manifestWithoutFingerprint,
      fingerprint: `semantic-assets-${this.digest(manifestWithoutFingerprint).slice(0, 16)}`
    };
  }

  summarize(manifest: SemanticAssetManifest): SemanticAssetManifestSummary {
    return {
      manifestVersion: manifest.manifestVersion,
      fingerprint: manifest.fingerprint,
      datasourceId: manifest.datasourceId,
      workspaceId: manifest.workspaceId,
      embeddingProfile: manifest.embeddingProfile,
      sourceSnapshotSummary: manifest.sourceSnapshotSummary,
      familyCounts: manifest.familyCounts,
      reasonCodes: manifest.reasonCodes,
      entryCount: manifest.entries.length,
      preparedEntryCount: manifest.entries.filter((entry) => entry.status === "prepared").length,
      skippedEntryCount: manifest.entries.filter((entry) => entry.status === "skipped").length,
      degradedEntryCount: manifest.entries.filter((entry) => entry.status === "degraded").length
    };
  }

  private buildEntry(
    input: BuildSemanticAssetManifestInput,
    trigger: SemanticAssetPreparationTrigger,
    rawSnapshot: unknown
  ): SemanticAssetManifestEntry {
    const snapshot = this.isSnapshot(rawSnapshot) ? rawSnapshot : undefined;
    const invalidSnapshot = rawSnapshot !== undefined && !snapshot;
    const family = snapshot?.family ?? this.familyForTrigger(trigger);
    const sourceRef = snapshot?.sourceRef ?? this.sourceRefForTrigger(trigger);
    const sourceVersion = snapshot?.sourceVersion ?? input.sourceVersion ?? `${trigger}:latest`;
    const enabled = snapshot?.enabled ?? true;
    const defaultSummary = {
      trigger,
      family,
      embeddingModel: input.embeddingProfile.model,
      embeddingProvider: input.embeddingProfile.provider,
      modelingRevision: snapshot?.modelingRevision ?? input.modelingRevision
    };
    const summary = snapshot?.summary ?? defaultSummary;
    const snapshotWasProvided = rawSnapshot !== undefined;
    const sourceHash =
      snapshot?.sourceHash ??
      (snapshotWasProvided ? undefined : this.digest({ sourceRef, sourceVersion, summary }));
    const status = this.resolveStatus({
      enabled,
      invalidSnapshot,
      sourceHash,
      snapshotWasProvided,
      snapshotStatus: snapshot?.status
    });
    const reasonCodes = this.reasonCodesForEntry({
      trigger,
      status,
      enabled,
      invalidSnapshot,
      sourceHash,
      snapshotWasProvided,
      snapshotReasonCodes: snapshot?.reasonCodes ?? []
    });

    return {
      id: `semantic-asset-entry-${this.digest({
        datasourceId: input.datasourceId,
        workspaceId: input.workspaceId,
        family,
        sourceRef,
        sourceVersion,
        sourceHash
      }).slice(0, 16)}`,
      family,
      sourceRef,
      sourceVersion,
      sourceHash,
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId,
      policyVersion: snapshot?.policyVersion,
      modelingRevision: snapshot?.modelingRevision ?? input.modelingRevision,
      visibilityScope: snapshot?.visibilityScope ?? "datasource",
      enabled,
      status,
      reasonCodes,
      summary,
      generatedChunkRefs: snapshot?.generatedChunkRefs ?? []
    };
  }

  private buildEntriesForTrigger(
    input: BuildSemanticAssetManifestInput,
    trigger: SemanticAssetPreparationTrigger
  ): SemanticAssetManifestEntry[] {
    const rawSnapshot = input.sourceSnapshots?.[trigger];
    if (Array.isArray(rawSnapshot)) {
      return rawSnapshot.map((snapshot) => this.buildEntry(input, trigger, snapshot));
    }
    return [this.buildEntry(input, trigger, rawSnapshot)];
  }

  private resolveStatus(input: {
    enabled: boolean;
    invalidSnapshot: boolean;
    sourceHash?: string;
    snapshotWasProvided: boolean;
    snapshotStatus?: SemanticAssetPreparationStatus;
  }): SemanticAssetPreparationStatus {
    if (!input.enabled) {
      return "skipped";
    }
    if (input.snapshotStatus) {
      return input.snapshotStatus;
    }
    if (input.invalidSnapshot || (input.snapshotWasProvided && !input.sourceHash)) {
      return "degraded";
    }
    return "prepared";
  }

  private reasonCodesForEntry(input: {
    trigger: SemanticAssetPreparationTrigger;
    status: SemanticAssetPreparationStatus;
    enabled: boolean;
    invalidSnapshot: boolean;
    sourceHash?: string;
    snapshotWasProvided: boolean;
    snapshotReasonCodes: readonly SemanticAssetReasonCode[];
  }): SemanticAssetReasonCode[] {
    const reasonCodes: SemanticAssetReasonCode[] = [
      `trigger:${input.trigger}`,
      ...input.snapshotReasonCodes
    ];
    if (!input.enabled) {
      reasonCodes.push(SEMANTIC_ASSET_REASON_CODES.skippedDisabled);
    } else if (input.invalidSnapshot) {
      reasonCodes.push(SEMANTIC_ASSET_REASON_CODES.degradedInvalidSourceSnapshot);
    } else if (input.snapshotWasProvided && !input.sourceHash) {
      reasonCodes.push(SEMANTIC_ASSET_REASON_CODES.degradedMissingSourceHash);
    } else if (input.status === "prepared") {
      reasonCodes.push(SEMANTIC_ASSET_REASON_CODES.prepared);
    }
    return this.unique(reasonCodes);
  }

  private familyForTrigger(trigger: SemanticAssetPreparationTrigger): SemanticAssetFamily {
    const familyByTrigger: Record<SemanticAssetPreparationTrigger, SemanticAssetFamily> = {
      schema: "full_schema",
      modeling_revision: "relationship_binding",
      examples: "prior_question_sql",
      instructions: "prompt_instruction",
      prior_sql: "prior_question_sql",
      embedding_model: "project_metadata"
    };
    return familyByTrigger[trigger];
  }

  private sourceRefForTrigger(trigger: SemanticAssetPreparationTrigger): SemanticAssetSourceRef {
    const refByTrigger: Record<SemanticAssetPreparationTrigger, SemanticAssetSourceRef> = {
      schema: { type: "datasource_schema", ref: "active-schema" },
      modeling_revision: { type: "modeling_graph", ref: "active-revision" },
      examples: { type: "sql_examples", ref: "eligible-examples" },
      instructions: { type: "prompt_instruction", ref: "runtime-eligible" },
      prior_sql: { type: "saved_prior_sql", ref: "eligible-prior-sql" },
      embedding_model: { type: "embedding_profile", ref: "active-runtime" }
    };
    return refByTrigger[trigger];
  }

  private countFamilies(
    entries: SemanticAssetManifestEntry[]
  ): Partial<Record<SemanticAssetFamily, number>> {
    return entries.reduce<Partial<Record<SemanticAssetFamily, number>>>((acc, entry) => {
      acc[entry.family] = (acc[entry.family] ?? 0) + 1;
      return acc;
    }, {});
  }

  private isSnapshot(value: unknown): value is SemanticAssetSourceSnapshot {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private entrySortKey(entry: SemanticAssetManifestEntry): string {
    return [
      entry.family,
      entry.sourceRef.type,
      entry.sourceRef.ref,
      entry.sourceVersion,
      entry.id
    ].join("|");
  }

  private unique<T extends string>(values: readonly T[]): T[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
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
