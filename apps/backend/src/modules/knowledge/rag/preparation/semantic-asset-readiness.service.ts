import { Injectable } from "@nestjs/common";
import { RagIndexRepository } from "../../../rag/index/rag-index.repository";
import type {
  SemanticAssetEmbeddingProfile,
  SemanticAssetFamily,
  SemanticAssetManifestSummary
} from "./semantic-asset-manifest.types";

export interface SemanticAssetReadinessActivationInput {
  datasourceId: string;
  workspaceId?: string;
  runId?: string;
  sourceVersion: string;
  indexVersionId?: string;
  manifestSummary: SemanticAssetManifestSummary;
  activatedAt?: string;
  previousActiveIndexVersionId?: string;
  staleReasons?: string[];
}

export interface SemanticAssetReadinessSummary {
  status: "ready" | "degraded" | "missing_active";
  datasourceId?: string;
  workspaceId?: string;
  activeManifestFingerprint?: string;
  activeIndexVersionId?: string;
  activeSourceVersion?: string;
  embeddingProfile?: SemanticAssetEmbeddingProfile;
  familyCounts: Partial<Record<SemanticAssetFamily, number>>;
  preparedEntryCount: number;
  degradedEntryCount: number;
  skippedEntryCount: number;
  degradedFamilies: SemanticAssetFamily[];
  skippedFamilies: SemanticAssetFamily[];
  staleReasons: string[];
  rebuildable: boolean;
  lastActivation?: {
    runId?: string;
    indexVersionId?: string;
    manifestFingerprint: string;
    activatedAt: string;
    previousActiveIndexVersionId?: string;
  };
  lastTrigger?: {
    runId?: string;
    sourceVersion: string;
    manifestFingerprint: string;
  };
  generatedAt: string;
}

@Injectable()
export class SemanticAssetReadinessService {
  private readonly summariesByDatasource = new Map<string, SemanticAssetReadinessSummary>();
  private latestDatasourceId?: string;

  constructor(private readonly indexRepository: RagIndexRepository) {}

  recordActivation(input: SemanticAssetReadinessActivationInput): SemanticAssetReadinessSummary {
    const datasourceId = input.datasourceId.trim();
    const summary = input.manifestSummary;
    const degradedFamilies = this.familiesForStatus(summary, "degraded");
    const skippedFamilies = this.familiesForStatus(summary, "skipped");
    const staleReasons = this.unique(input.staleReasons ?? []);
    const status =
      degradedFamilies.length > 0 || staleReasons.length > 0 ? "degraded" : "ready";
    const manifestFingerprint = summary.fingerprint;
    const generatedAt = new Date().toISOString();
    const readiness: SemanticAssetReadinessSummary = {
      status,
      datasourceId,
      workspaceId: input.workspaceId,
      activeManifestFingerprint: manifestFingerprint,
      activeIndexVersionId: input.indexVersionId,
      activeSourceVersion: input.sourceVersion,
      embeddingProfile: summary.embeddingProfile,
      familyCounts: { ...summary.familyCounts },
      preparedEntryCount: summary.preparedEntryCount,
      degradedEntryCount: summary.degradedEntryCount,
      skippedEntryCount: summary.skippedEntryCount,
      degradedFamilies,
      skippedFamilies,
      staleReasons,
      rebuildable: staleReasons.length > 0,
      lastActivation: {
        runId: input.runId,
        indexVersionId: input.indexVersionId,
        manifestFingerprint,
        activatedAt: input.activatedAt ?? generatedAt,
        previousActiveIndexVersionId: input.previousActiveIndexVersionId
      },
      lastTrigger: {
        runId: input.runId,
        sourceVersion: input.sourceVersion,
        manifestFingerprint
      },
      generatedAt
    };
    this.summariesByDatasource.set(datasourceId, readiness);
    this.latestDatasourceId = datasourceId;
    return this.clone(readiness);
  }

  async snapshot(input?: { datasourceId?: string }): Promise<SemanticAssetReadinessSummary> {
    const datasourceId = input?.datasourceId?.trim() || this.latestDatasourceId;
    if (!datasourceId) {
      return this.emptySummary();
    }

    const current = this.summariesByDatasource.get(datasourceId);
    const activeVersion = await this.indexRepository.getActiveVersion(datasourceId);
    if (!activeVersion) {
      return {
        ...(current ?? this.emptySummary()),
        status: "missing_active",
        datasourceId,
        activeIndexVersionId: undefined,
        activeSourceVersion: undefined,
        staleReasons: this.unique([...(current?.staleReasons ?? []), "no_active_index"]),
        rebuildable: true,
        generatedAt: new Date().toISOString()
      };
    }

    if (!current) {
      return {
        ...this.emptySummary(),
        status: "ready",
        datasourceId,
        activeIndexVersionId: activeVersion.id,
        activeSourceVersion: activeVersion.sourceVersion,
        activeManifestFingerprint: this.extractManifestFingerprint(activeVersion.sourceVersion),
        lastActivation: activeVersion.activatedAt
          ? {
              indexVersionId: activeVersion.id,
              manifestFingerprint:
                this.extractManifestFingerprint(activeVersion.sourceVersion) ??
                activeVersion.sourceVersion,
              activatedAt: activeVersion.activatedAt
            }
          : undefined,
        generatedAt: new Date().toISOString()
      };
    }

    const activeManifestFingerprint = this.extractManifestFingerprint(activeVersion.sourceVersion);
    const staleReasons =
      current.activeSourceVersion && current.activeSourceVersion !== activeVersion.sourceVersion
        ? this.unique([...current.staleReasons, "active_index_changed"])
        : current.staleReasons;
    return {
      ...this.clone(current),
      activeIndexVersionId: activeVersion.id,
      activeSourceVersion: activeVersion.sourceVersion,
      activeManifestFingerprint: activeManifestFingerprint ?? current.activeManifestFingerprint,
      status:
        staleReasons.length > 0 || current.degradedFamilies.length > 0
          ? "degraded"
          : "ready",
      staleReasons,
      rebuildable: staleReasons.length > 0,
      generatedAt: new Date().toISOString()
    };
  }

  private emptySummary(): SemanticAssetReadinessSummary {
    return {
      status: "missing_active",
      familyCounts: {},
      preparedEntryCount: 0,
      degradedEntryCount: 0,
      skippedEntryCount: 0,
      degradedFamilies: [],
      skippedFamilies: [],
      staleReasons: [],
      rebuildable: false,
      generatedAt: new Date().toISOString()
    };
  }

  private familiesForStatus(
    summary: SemanticAssetManifestSummary,
    status: "degraded" | "skipped"
  ): SemanticAssetFamily[] {
    const reasonMarker = status === "degraded" ? "degraded" : "skipped";
    const entryCount =
      status === "degraded" ? summary.degradedEntryCount : summary.skippedEntryCount;
    if (entryCount === 0) {
      return [];
    }
    return Object.keys(summary.familyCounts)
      .filter((family): family is SemanticAssetFamily => Boolean(family))
      .filter(() => summary.reasonCodes.some((reason) => reason.includes(reasonMarker)))
      .sort();
  }

  private extractManifestFingerprint(sourceVersion: string): string | undefined {
    const [fingerprint] = sourceVersion.trim().split(":");
    return fingerprint || undefined;
  }

  private clone(summary: SemanticAssetReadinessSummary): SemanticAssetReadinessSummary {
    return {
      ...summary,
      familyCounts: { ...summary.familyCounts },
      degradedFamilies: [...summary.degradedFamilies],
      skippedFamilies: [...summary.skippedFamilies],
      staleReasons: [...summary.staleReasons],
      lastActivation: summary.lastActivation ? { ...summary.lastActivation } : undefined,
      lastTrigger: summary.lastTrigger ? { ...summary.lastTrigger } : undefined
    };
  }

  private unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0))).sort();
  }
}
