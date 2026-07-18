import { Injectable } from "@nestjs/common";
import type {
  KnowledgeAssetEvaluationV1,
  KnowledgeAssetKind,
  KnowledgeAssetScopeType,
  KnowledgeAssetStatus,
  KnowledgeAssetV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import {
  AnalysisLedgerPrismaService,
  type AnalysisPrismaClient
} from "../../platform/data/persistence/analysis-ledger-prisma.service";
import {
  parseJson,
  sha256Digest,
  stableJson
} from "../../platform/data/persistence/analysis-ledger.util";
import {
  KnowledgePromotionPolicy,
  type KnowledgePromotionDecision,
  type KnowledgePromotionEvidenceInput
} from "./knowledge-promotion-policy";

type KnowledgeAssetRow = {
  id: string;
  workspaceId: string;
  assetKind: string;
  assetKey: string;
  version: number;
  status: string;
  stateVersion: number;
  scopeType: string;
  scopeRef: string | null;
  authorityLevel: string;
  createdByActorId: string;
  content: string;
  contentDigest: string;
  sourceRefs: string;
  capabilityCeiling: string;
  evaluation: string;
  rollbackRef: string | null;
  idempotencyKey: string;
  validFrom: Date | null;
  validTo: Date | null;
  heldAt: Date | null;
  tombstonedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class KnowledgeAssetService {
  constructor(
    private readonly prisma: AnalysisLedgerPrismaService,
    private readonly policy: KnowledgePromotionPolicy
  ) {}

  isReady(): boolean {
    return this.prisma.isReady();
  }

  async createCandidate(input: {
    workspaceId: string;
    assetKind: KnowledgeAssetKind;
    assetKey: string;
    scope: { type: KnowledgeAssetScopeType; ref?: string };
    authority: { level: string; actorId: string };
    content: Record<string, unknown>;
    sourceRefs: string[];
    capabilityCeiling?: string[];
    evaluation?: KnowledgePromotionEvidenceInput;
    idempotencyKey: string;
    validFrom?: string;
    validTo?: string;
  }): Promise<KnowledgeAssetV1> {
    this.assertCandidate(input);
    const contentDigest = sha256Digest(stableJson(input.content));
    const evaluation = this.policy.initialEvaluation({
      ...(input.evaluation ?? {}),
      requestedCapabilities: input.capabilityCeiling ?? []
    });
    const row = await this.prisma.transaction(async (transaction) => {
      const existing = (await transaction.knowledgeAsset.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyKey: input.idempotencyKey
          }
        }
      })) as KnowledgeAssetRow | null;
      if (existing) {
        if (
          existing.assetKind !== input.assetKind ||
          existing.assetKey !== input.assetKey ||
          existing.contentDigest !== contentDigest
        ) {
          throw new DomainError(
            "KNOWLEDGE_ASSET_IDEMPOTENCY_CONFLICT",
            "KnowledgeAsset idempotency key 已绑定不同 candidate。",
            409
          );
        }
        return existing;
      }
      const latest = (await transaction.knowledgeAsset.findFirst({
        where: {
          workspaceId: input.workspaceId,
          assetKind: input.assetKind,
          assetKey: input.assetKey
        },
        orderBy: { version: "desc" }
      })) as KnowledgeAssetRow | null;
      const assetId = `knowledge:${sha256Digest(
        stableJson({
          workspaceId: input.workspaceId,
          assetKind: input.assetKind,
          assetKey: input.assetKey,
          contentDigest,
          idempotencyKey: input.idempotencyKey
        })
      )}`;
      const created = (await transaction.knowledgeAsset.create({
        data: {
          id: assetId,
          workspaceId: input.workspaceId,
          assetKind: input.assetKind,
          assetKey: input.assetKey,
          version: (latest?.version ?? 0) + 1,
          status: "candidate",
          stateVersion: 1,
          scopeType: input.scope.type,
          scopeRef: input.scope.ref ?? null,
          authorityLevel: input.authority.level,
          createdByActorId: input.authority.actorId,
          content: stableJson(input.content),
          contentDigest,
          sourceRefs: stableJson(unique(input.sourceRefs)),
          capabilityCeiling: stableJson(unique(input.capabilityCeiling ?? [])),
          evaluation: stableJson(evaluation),
          rollbackRef: null,
          idempotencyKey: input.idempotencyKey,
          validFrom: input.validFrom ? new Date(input.validFrom) : null,
          validTo: input.validTo ? new Date(input.validTo) : null
        }
      })) as KnowledgeAssetRow;
      await transaction.knowledgeAssetTransition.create({
        data: {
          id: transitionId(assetId, input.idempotencyKey),
          assetId,
          fromStatus: null,
          toStatus: "candidate",
          actorId: input.authority.actorId,
          decisionRef: null,
          evidenceRefs: stableJson(unique(input.sourceRefs)),
          reasonCodes: ["single_observation_created_candidate_only"],
          idempotencyKey: input.idempotencyKey
        }
      });
      return created;
    });
    return this.map(row);
  }

  async get(assetId: string): Promise<KnowledgeAssetV1 | null> {
    const row = (await this.prisma.requireClient().knowledgeAsset.findUnique({
      where: { id: assetId }
    })) as KnowledgeAssetRow | null;
    return row ? this.map(row) : null;
  }

  async listActive(input: {
    workspaceId: string;
    assetKind?: KnowledgeAssetKind;
    capabilityGrant?: string[];
    at?: string;
  }): Promise<KnowledgeAssetV1[]> {
    const rows = (await this.prisma.requireClient().knowledgeAsset.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: "active",
        ...(input.assetKind ? { assetKind: input.assetKind } : {})
      },
      orderBy: [{ assetKind: "asc" }, { assetKey: "asc" }, { version: "desc" }]
    })) as KnowledgeAssetRow[];
    const at = input.at ? new Date(input.at).getTime() : Date.now();
    const grant = new Set(input.capabilityGrant ?? []);
    return rows
      .filter((row) => withinValidity(row, at))
      .map((row) => this.map(row))
      .filter((asset) =>
        asset.capabilityCeiling.every((capability) => grant.has(capability))
      );
  }

  async promote(input: {
    assetId: string;
    expectedStateVersion: number;
    actorId: string;
    idempotencyKey: string;
    evidence: KnowledgePromotionEvidenceInput;
  }): Promise<{ asset: KnowledgeAssetV1; decision: KnowledgePromotionDecision }> {
    return this.prisma.transaction(async (transaction) => {
      const existingTransition = await transaction.knowledgeAssetTransition.findUnique({
        where: {
          assetId_idempotencyKey: {
            assetId: input.assetId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      const current = await this.requireRow(transaction, input.assetId);
      if (existingTransition) {
        return {
          asset: this.map(current),
          decision: this.policy.evaluate({
            status: current.status as KnowledgeAssetStatus,
            currentEvaluation: this.evaluation(current),
            evidence: input.evidence
          })
        };
      }
      if (current.stateVersion !== input.expectedStateVersion) {
        throw new DomainError(
          "KNOWLEDGE_ASSET_STATE_CONFLICT",
          "KnowledgeAsset state version 已变化。",
          409
        );
      }
      const decision = this.policy.evaluate({
        status: current.status as KnowledgeAssetStatus,
        currentEvaluation: this.evaluation(current),
        evidence: input.evidence
      });
      const next = await this.applyTransition(transaction, current, {
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        toStatus: decision.nextStatus,
        decisionRef: decision.evaluation.approvalDecisionRef,
        evidenceRefs: promotionRefs(decision.evaluation),
        reasonCodes: decision.reasonCodes,
        evaluation: decision.evaluation,
        rollbackRef: decision.rollbackRef ?? current.rollbackRef ?? undefined
      });
      return { asset: this.map(next), decision };
    });
  }

  async rollback(input: {
    assetId: string;
    expectedStateVersion: number;
    actorId: string;
    decisionRef: string;
    idempotencyKey: string;
    reasonCodes?: string[];
  }): Promise<KnowledgeAssetV1> {
    return this.prisma.transaction(async (transaction) => {
      const existingTransition = await transaction.knowledgeAssetTransition.findUnique({
        where: {
          assetId_idempotencyKey: {
            assetId: input.assetId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      const current = await this.requireRow(transaction, input.assetId);
      if (existingTransition) {
        return this.map(current);
      }
      if (
        current.stateVersion !== input.expectedStateVersion ||
        !["active", "canary", "held"].includes(current.status)
      ) {
        throw new DomainError(
          "KNOWLEDGE_ASSET_ROLLBACK_CONFLICT",
          "KnowledgeAsset 不在可回滚状态或 state version 已变化。",
          409
        );
      }
      if (!current.rollbackRef) {
        throw new DomainError(
          "KNOWLEDGE_ASSET_ROLLBACK_POINTER_REQUIRED",
          "KnowledgeAsset rollback 需要已冻结的 rollback pointer。",
          409
        );
      }
      const next = await this.applyTransition(transaction, current, {
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        toStatus: "rolled_back",
        decisionRef: input.decisionRef,
        evidenceRefs: [current.rollbackRef],
        reasonCodes: input.reasonCodes ?? ["governed_rollback_applied"],
        evaluation: {
          ...this.evaluation(current),
          reasonCodes: input.reasonCodes ?? ["governed_rollback_applied"]
        },
        rollbackRef: current.rollbackRef
      });
      return this.map(next);
    });
  }

  async holdImpactedBySources(input: {
    workspaceId: string;
    sourceRefs: string[];
    correctionRef: string;
    actorId: string;
  }): Promise<string[]> {
    const sourceSet = new Set(input.sourceRefs);
    return this.prisma.transaction(async (transaction) => {
      const rows = (await transaction.knowledgeAsset.findMany({
        where: {
          workspaceId: input.workspaceId,
          status: {
            in: ["candidate", "verified", "shadow", "canary", "active", "held"]
          }
        }
      })) as KnowledgeAssetRow[];
      const impacted = rows.filter((row) =>
        parseJson<string[]>(row.sourceRefs, []).some((ref) => sourceSet.has(ref))
      );
      const ids: string[] = [];
      for (const row of impacted) {
        const transitionKey = `correction:${input.correctionRef}`;
        const existingTransition =
          await transaction.knowledgeAssetTransition.findUnique({
            where: {
              assetId_idempotencyKey: {
                assetId: row.id,
                idempotencyKey: transitionKey
              }
            }
          });
        if (existingTransition) {
          ids.push(row.id);
          continue;
        }
        const toStatus = row.status === "candidate" ? "tombstoned" : "held";
        await this.applyTransition(transaction, row, {
          actorId: input.actorId,
          idempotencyKey: transitionKey,
          toStatus,
          decisionRef: input.correctionRef,
          evidenceRefs: input.sourceRefs,
          reasonCodes: ["source_correction_invalidated_asset"],
          evaluation: {
            ...this.evaluation(row),
            ...(toStatus === "held"
              ? {
                  heldFromStatus:
                    row.status === "held"
                      ? this.evaluation(row).heldFromStatus ?? "candidate"
                      : (row.status as Exclude<KnowledgeAssetStatus, "held">)
                }
              : {}),
            reasonCodes: ["source_correction_invalidated_asset"]
          },
          rollbackRef: row.rollbackRef ?? undefined
        });
        ids.push(row.id);
      }
      return ids.sort();
    });
  }

  private async applyTransition(
    transaction: AnalysisPrismaClient,
    current: KnowledgeAssetRow,
    input: {
      actorId: string;
      idempotencyKey: string;
      toStatus: KnowledgeAssetStatus;
      decisionRef?: string;
      evidenceRefs: string[];
      reasonCodes: string[];
      evaluation: KnowledgeAssetEvaluationV1;
      rollbackRef?: string;
    }
  ): Promise<KnowledgeAssetRow> {
    const updated = await transaction.knowledgeAsset.updateMany({
      where: { id: current.id, stateVersion: current.stateVersion },
      data: {
        status: input.toStatus,
        stateVersion: current.stateVersion + 1,
        evaluation: stableJson(input.evaluation),
        rollbackRef: input.rollbackRef ?? null,
        heldAt: input.toStatus === "held" ? new Date() : current.heldAt,
        tombstonedAt:
          input.toStatus === "tombstoned" ? new Date() : current.tombstonedAt
      }
    });
    if (updated.count !== 1) {
      throw new DomainError(
        "KNOWLEDGE_ASSET_STATE_CONFLICT",
        "KnowledgeAsset 并发状态转换冲突。",
        409
      );
    }
    await transaction.knowledgeAssetTransition.create({
      data: {
        id: transitionId(current.id, input.idempotencyKey),
        assetId: current.id,
        fromStatus: current.status,
        toStatus: input.toStatus,
        actorId: input.actorId,
        decisionRef: input.decisionRef ?? null,
        evidenceRefs: stableJson(unique(input.evidenceRefs)),
        reasonCodes: unique(input.reasonCodes),
        idempotencyKey: input.idempotencyKey
      }
    });
    return this.requireRow(transaction, current.id);
  }

  private async requireRow(
    transaction: AnalysisPrismaClient,
    assetId: string
  ): Promise<KnowledgeAssetRow> {
    const row = (await transaction.knowledgeAsset.findUnique({
      where: { id: assetId }
    })) as KnowledgeAssetRow | null;
    if (!row) {
      throw new DomainError(
        "KNOWLEDGE_ASSET_NOT_FOUND",
        "未找到 KnowledgeAsset。",
        404
      );
    }
    return row;
  }

  private evaluation(row: KnowledgeAssetRow): KnowledgeAssetEvaluationV1 {
    return parseJson<KnowledgeAssetEvaluationV1>(
      row.evaluation,
      this.policy.initialEvaluation()
    );
  }

  private map(row: KnowledgeAssetRow): KnowledgeAssetV1 {
    return {
      version: "knowledge-asset.v1",
      id: row.id,
      workspaceId: row.workspaceId,
      assetKind: row.assetKind as KnowledgeAssetKind,
      assetKey: row.assetKey,
      assetVersion: row.version,
      status: row.status as KnowledgeAssetStatus,
      stateVersion: row.stateVersion,
      scope: {
        type: row.scopeType as KnowledgeAssetScopeType,
        ...(row.scopeRef ? { ref: row.scopeRef } : {})
      },
      authority: {
        level: row.authorityLevel,
        actorId: row.createdByActorId
      },
      content: parseJson<Record<string, unknown>>(row.content, {}),
      contentDigest: row.contentDigest,
      sourceRefs: parseJson<string[]>(row.sourceRefs, []),
      capabilityCeiling: parseJson<string[]>(row.capabilityCeiling, []),
      evaluation: this.evaluation(row),
      ...(row.rollbackRef ? { rollbackRef: row.rollbackRef } : {}),
      ...(row.validFrom ? { validFrom: row.validFrom.toISOString() } : {}),
      ...(row.validTo ? { validTo: row.validTo.toISOString() } : {}),
      ...(row.heldAt ? { heldAt: row.heldAt.toISOString() } : {}),
      ...(row.tombstonedAt
        ? { tombstonedAt: row.tombstonedAt.toISOString() }
        : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private assertCandidate(input: {
    workspaceId: string;
    assetKey: string;
    scope: { type: KnowledgeAssetScopeType; ref?: string };
    authority: { level: string; actorId: string };
    content: Record<string, unknown>;
    sourceRefs: string[];
    idempotencyKey: string;
  }): void {
    if (
      !input.workspaceId.trim() ||
      !input.assetKey.trim() ||
      !input.authority.actorId.trim() ||
      !input.idempotencyKey.trim() ||
      input.sourceRefs.length === 0 ||
      Object.keys(input.content).length === 0
    ) {
      throw new DomainError(
        "KNOWLEDGE_ASSET_CANDIDATE_INVALID",
        "KnowledgeAsset candidate 缺少 scope、authority、content 或 source refs。",
        400
      );
    }
    if (
      ["global", "system"].includes(input.scope.type) &&
      input.authority.level !== "system_admin"
    ) {
      throw new DomainError(
        "KNOWLEDGE_ASSET_AUTHORITY_REQUIRED",
        "global/system KnowledgeAsset 需要 system_admin authority。",
        403
      );
    }
  }
}

function promotionRefs(evaluation: KnowledgeAssetEvaluationV1): string[] {
  return unique([
    ...evaluation.independentEvidenceRefs,
    ...evaluation.regressionReceiptRefs,
    ...evaluation.pairedEvaluationRefs,
    ...evaluation.canaryReceiptRefs,
    ...(evaluation.approvalDecisionRef ? [evaluation.approvalDecisionRef] : [])
  ]);
}

function transitionId(assetId: string, idempotencyKey: string): string {
  return `knowledge-transition:${sha256Digest(stableJson({ assetId, idempotencyKey }))}`;
}

function withinValidity(row: KnowledgeAssetRow, at: number): boolean {
  return (!row.validFrom || row.validFrom.getTime() <= at) &&
    (!row.validTo || row.validTo.getTime() > at);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))].sort();
}
