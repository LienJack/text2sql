import { Inject, Injectable } from "@nestjs/common";
import type { AnalysisCorrectionImpactV1 } from "@text2sql/shared-types";
import { KNOWLEDGE_ASSET_CONTRACT } from "../../../knowledge";
import type { KnowledgeAssetContract } from "../../../knowledge";
import { DomainError } from "../../../../common/domain-error";
import {
  AnalysisLedgerPrismaService,
  type AnalysisPrismaClient
} from "../../../platform/data/persistence/analysis-ledger-prisma.service";
import {
  parseJson,
  sha256Digest,
  stableJson
} from "../../../platform/data/persistence/analysis-ledger.util";
import { AnalysisTaskRepository } from "../../../platform/data/persistence/analysis-task.repository";

type ArtifactRow = { id: string; artifactType: string };
type LinkRow = { sourceArtifactId: string; targetArtifactId: string };
type ManifestRow = { id: string; artifactRefs: string };

@Injectable()
export class CorrectionImpactService {
  constructor(
    private readonly prisma: AnalysisLedgerPrismaService,
    private readonly tasks: AnalysisTaskRepository,
    @Inject(KNOWLEDGE_ASSET_CONTRACT)
    private readonly knowledgeAssets: KnowledgeAssetContract
  ) {}

  async apply(input: {
    taskId: string;
    revisionId: string;
    attemptId?: string;
    workspaceId: string;
    correctionRef: string;
    targetArtifactRefs: string[];
    actorId: string;
    computedAt?: string;
  }): Promise<AnalysisCorrectionImpactV1> {
    const computedAt = input.computedAt ?? new Date().toISOString();
    const graph = await this.prisma.transaction((transaction) =>
      this.computeAndMark(transaction, input, computedAt)
    );
    const impactedKnowledgeAssetRefs =
      await this.knowledgeAssets.holdImpactedBySources({
        workspaceId: input.workspaceId,
        sourceRefs: graph.impactedArtifactRefs,
        correctionRef: input.correctionRef,
        actorId: input.actorId
      });
    const unsigned = {
      version: "analysis-correction-impact.v1" as const,
      correctionRef: input.correctionRef,
      targetArtifactRefs: [...new Set(input.targetArtifactRefs)].sort(),
      impactedArtifactRefs: graph.impactedArtifactRefs,
      invalidatedArtifactRefs: graph.invalidatedArtifactRefs,
      staleArtifactRefs: graph.staleArtifactRefs,
      impactedKnowledgeAssetRefs,
      affectedKinds: graph.affectedKinds,
      requiresNewRevision: true as const,
      computedAt
    };
    const impact: AnalysisCorrectionImpactV1 = {
      ...unsigned,
      impactDigest: sha256Digest(stableJson(unsigned))
    };
    await this.tasks.appendEvent({
      taskId: input.taskId,
      revisionId: input.revisionId,
      attemptId: input.attemptId,
      idempotencyKey: `correction-impact:${input.correctionRef}`,
      eventType: "correction.impact.applied",
      data: impact as unknown as Record<string, unknown>
    });
    return impact;
  }

  private async computeAndMark(
    transaction: AnalysisPrismaClient,
    input: {
      taskId: string;
      correctionRef: string;
      targetArtifactRefs: string[];
    },
    computedAt: string
  ): Promise<{
    impactedArtifactRefs: string[];
    invalidatedArtifactRefs: string[];
    staleArtifactRefs: string[];
    affectedKinds: string[];
  }> {
    const artifacts = (await transaction.analysisArtifact.findMany({
      where: { taskId: input.taskId }
    })) as ArtifactRow[];
    const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const targets = [...new Set(input.targetArtifactRefs)].sort();
    if (targets.some((target) => !artifactById.has(target))) {
      throw new DomainError(
        "ANALYSIS_CORRECTION_TARGET_INVALID",
        "Correction target 必须属于当前 Task。",
        400
      );
    }
    const links = (await transaction.analysisArtifactLink.findMany({
      where: { taskId: input.taskId }
    })) as LinkRow[];
    const dependents = new Map<string, string[]>();
    for (const link of links) {
      const values = dependents.get(link.targetArtifactId) ?? [];
      values.push(link.sourceArtifactId);
      dependents.set(link.targetArtifactId, values);
    }
    const impacted = new Set(targets);
    const queue = [...targets];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const dependent of dependents.get(current) ?? []) {
        const artifact = artifactById.get(dependent);
        if (
          impacted.has(dependent) ||
          dependent === input.correctionRef ||
          artifact?.artifactType === "analysis.correction"
        ) {
          continue;
        }
        impacted.add(dependent);
        queue.push(dependent);
      }
    }
    const invalidatedArtifactRefs = targets;
    const staleArtifactRefs = [...impacted]
      .filter((artifactId) => !targets.includes(artifactId))
      .sort();
    const at = new Date(computedAt);
    if (invalidatedArtifactRefs.length > 0) {
      await transaction.analysisArtifact.updateMany({
        where: { id: { in: invalidatedArtifactRefs }, taskId: input.taskId },
        data: { invalidatedAt: at, staleAt: at }
      });
    }
    if (staleArtifactRefs.length > 0) {
      await transaction.analysisArtifact.updateMany({
        where: { id: { in: staleArtifactRefs }, taskId: input.taskId },
        data: { staleAt: at }
      });
    }
    const manifests = (await transaction.analysisManifest.findMany({
      where: { taskId: input.taskId }
    })) as ManifestRow[];
    for (const manifest of manifests) {
      if (
        parseJson<string[]>(manifest.artifactRefs, []).some((ref) =>
          impacted.has(ref)
        )
      ) {
        await transaction.analysisManifest.update({
          where: { id: manifest.id },
          data: { staleAt: at }
        });
      }
    }
    const impactedArtifactRefs = [...impacted].sort();
    return {
      impactedArtifactRefs,
      invalidatedArtifactRefs,
      staleArtifactRefs,
      affectedKinds: [
        ...new Set(
          impactedArtifactRefs
            .map((artifactId) => artifactById.get(artifactId)?.artifactType)
            .filter((kind): kind is string => Boolean(kind))
        )
      ].sort()
    };
  }
}
