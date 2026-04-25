import { Injectable } from "@nestjs/common";
import { RagReplayRepository } from "../observability/rag-replay.repository";
import { RagBudgetPolicy } from "../../../rag/perf/rag-budget-policy";
import { RagCacheKeyFactory } from "../../../rag/perf/rag-cache-key.factory";
import { RagQueryCacheService } from "../../../rag/perf/rag-query-cache.service";
import { RagQualityService } from "../../../rag/quality/rag-quality.service";
import {
  type RagBudgetSignal,
  type RagRetrievalBundle,
  type RagRetrievalCandidate,
  type RagRerankedCandidate
} from "../../../rag/retrieval/rag-retrieval.types";
import { ModelRerankerAdapter } from "../../../rag/rerank/model-reranker.adapter";

export interface RagRerankRequest {
  retrievalBundle: RagRetrievalBundle;
  modelCatalogId?: string;
  secondaryEnabled?: boolean;
  secondaryTopK?: number;
  secondaryMinCandidates?: number;
  secondaryTimeoutMs?: number;
  selectedContextLimit?: number;
  budgetSignal?: RagBudgetSignal;
}

export interface RagRerankResponse {
  retrieval_bundle: RagRetrievalBundle;
}

const DEFAULT_SECONDARY_TOP_K = 8;
const DEFAULT_SECONDARY_TIMEOUT_MS = 350;
const DEFAULT_SECONDARY_MIN_CANDIDATES = 3;
const DEFAULT_SELECTED_CONTEXT_LIMIT = 6;
const RERANK_CACHE_L1_TTL_MS = 20_000;
const RERANK_CACHE_L2_TTL_MS = 3 * 60_000;

@Injectable()
export class RagRerankService {
  constructor(
    private readonly modelReranker: ModelRerankerAdapter,
    private readonly replayRepository: RagReplayRepository,
    private readonly budgetPolicy: RagBudgetPolicy,
    private readonly cacheKeyFactory: RagCacheKeyFactory,
    private readonly queryCache: RagQueryCacheService,
    private readonly ragQualityService: RagQualityService
  ) {}

  async rerank(input: RagRerankRequest): Promise<RagRerankResponse> {
    const bundle = input.retrievalBundle;
    const rerankDegradeReasons: string[] = [];
    const selectedContextLimit = this.normalizePositiveInt(
      input.selectedContextLimit,
      DEFAULT_SELECTED_CONTEXT_LIMIT
    );
    const requestedSecondaryTopK = this.normalizePositiveInt(
      input.secondaryTopK,
      DEFAULT_SECONDARY_TOP_K
    );
    const budgetDecision = this.budgetPolicy.planRerank({
      requestedSecondaryTopK,
      signal: input.budgetSignal
    });
    rerankDegradeReasons.push(...budgetDecision.decisionReasons);

    const cacheKey = this.cacheKeyFactory.build({
      stage: "rerank_bundle",
      datasourceId: bundle.datasource_id,
      indexVersionId: bundle.index_version_id ?? "none",
      query: bundle.query,
      budgetProfile: budgetDecision.secondaryEnabled
        ? "secondary_enabled"
        : "secondary_disabled",
      secondaryTopK: budgetDecision.secondaryTopK,
      selectedContextLimit
    });
    const cacheRead = this.queryCache.get<RagRetrievalBundle>(cacheKey);
    if (cacheRead.hit && cacheRead.value) {
      this.ragQualityService.recordCacheBudget({
        cacheEligible: true,
        cacheHit: true,
        budgetDegraded: budgetDecision.degraded
      });
      return {
        retrieval_bundle: {
          ...cacheRead.value,
          run_id: bundle.run_id,
          decision_reasons: this.unique([
            ...(cacheRead.value.decision_reasons ?? []),
            ...budgetDecision.decisionReasons,
            "cache_hit"
          ]),
          degrade_reasons: this.unique([
            ...(cacheRead.value.degrade_reasons ?? [])
          ])
        }
      };
    }

    const primary = this.primaryRerank(bundle.candidates);
    await this.writePrimaryReplay(bundle, primary);

    let secondaryScores: Record<string, { score: number; reason: string }> = {};
    const secondaryEnabled = input.secondaryEnabled ?? true;
    const secondaryMinCandidates = this.normalizePositiveInt(
      input.secondaryMinCandidates,
      DEFAULT_SECONDARY_MIN_CANDIDATES
    );
    const secondaryTopK = budgetDecision.secondaryTopK;
    const secondaryTimeoutMs = this.normalizePositiveInt(
      input.secondaryTimeoutMs,
      DEFAULT_SECONDARY_TIMEOUT_MS
    );

    if (!budgetDecision.secondaryEnabled) {
      rerankDegradeReasons.push("secondary_rerank_disabled_by_budget");
      await this.writeSecondaryReplay(bundle, {
        status: "skipped",
        reason: "secondary_rerank_disabled_by_budget",
        timeoutMs: secondaryTimeoutMs
      });
    } else if (!secondaryEnabled) {
      rerankDegradeReasons.push("secondary_rerank_disabled");
      await this.writeSecondaryReplay(bundle, {
        status: "skipped",
        reason: "secondary_rerank_disabled",
        timeoutMs: secondaryTimeoutMs
      });
    } else if (primary.length < secondaryMinCandidates) {
      rerankDegradeReasons.push("secondary_rerank_skipped_low_candidates");
      await this.writeSecondaryReplay(bundle, {
        status: "skipped",
        reason: "secondary_rerank_skipped_low_candidates",
        timeoutMs: secondaryTimeoutMs
      });
    } else {
      try {
        secondaryScores = await this.withTimeout(
          this.runSecondaryRerank(bundle, primary.slice(0, secondaryTopK), input.modelCatalogId),
          secondaryTimeoutMs,
          "secondary_rerank_timeout"
        );
        await this.writeSecondaryReplay(bundle, {
          status: "ok",
          timeoutMs: secondaryTimeoutMs,
          scores: secondaryScores
        });
      } catch (error) {
        const reason =
          error instanceof Error && error.message.trim()
            ? error.message
            : "secondary_rerank_failed";
        rerankDegradeReasons.push(reason);
        await this.writeSecondaryReplay(bundle, {
          status: "degraded",
          reason,
          timeoutMs: secondaryTimeoutMs
        });
      }
    }

    const reranked = this.mergePrimaryWithSecondary(primary, secondaryScores);
    const degradeReasons = this.unique([...bundle.degrade_reasons, ...rerankDegradeReasons]);
    const selectedContext = reranked
      .slice(0, selectedContextLimit)
      .map((item) => item.chunk);

    const responseBundle: RagRetrievalBundle = {
      ...bundle,
      status: degradeReasons.length > 0 ? "degraded" : "ready",
      degrade_reasons: degradeReasons,
      reranked,
      selected_context: selectedContext,
      risk_tags: this.buildRiskTags({
        degradeReasons,
        reranked
      }),
      decision_reasons: this.unique([
        ...(bundle.decision_reasons ?? []),
        ...budgetDecision.decisionReasons
      ])
    };
    const existingContextPack = bundle.context_pack;
    responseBundle.context_pack = {
      status: responseBundle.status,
      semantic_version: existingContextPack?.semantic_version,
      modeling_revision: existingContextPack?.modeling_revision,
      semantic_lock_status:
        responseBundle.status === "ready"
          ? existingContextPack?.semantic_lock_status ?? "locked"
          : "degraded",
      semantic_bindings: existingContextPack?.semantic_bindings ?? {
        model_keys: [],
        relationship_keys: [],
        metric_keys: [],
        calculated_field_keys: []
      },
      instruction_sets: existingContextPack?.instruction_sets ?? {
        model_bindings: [],
        relationship_bindings: [],
        metric_bindings: [],
        calculated_field_bindings: []
      },
      selected_context_summary: {
        count: selectedContext.length,
        snippets: selectedContext.map((chunk) => chunk.content.slice(0, 160)).slice(0, 5)
      },
      degrade_reasons: this.unique([
        ...(existingContextPack?.degrade_reasons ?? []),
        ...degradeReasons
      ]),
      risk_tags: this.unique([
        ...(existingContextPack?.risk_tags ?? []),
        ...(responseBundle.risk_tags ?? [])
      ])
    };
    await this.writeBudgetReplay(responseBundle, {
      decisionReasons: budgetDecision.decisionReasons,
      secondaryEnabled: budgetDecision.secondaryEnabled,
      secondaryTopK
    });
    this.queryCache.set({
      key: cacheKey,
      stage: "rerank_bundle",
      datasourceId: responseBundle.datasource_id,
      indexVersionId: responseBundle.index_version_id ?? "none",
      value: responseBundle,
      l1TtlMs: RERANK_CACHE_L1_TTL_MS,
      l2TtlMs: RERANK_CACHE_L2_TTL_MS
    });
    this.ragQualityService.recordCacheBudget({
      cacheEligible: true,
      cacheHit: false,
      budgetDegraded: budgetDecision.degraded
    });
    await this.writeFinalReplay(responseBundle);
    return {
      retrieval_bundle: responseBundle
    };
  }

  private primaryRerank(candidates: RagRetrievalCandidate[]): RagRerankedCandidate[] {
    return candidates
      .map((candidate) => {
        const domainBoost = this.domainBoost(candidate.chunk.metadata.domain);
        const evidenceBoost = Math.min(0.12, candidate.evidence.length * 0.03);
        const laneBoost = candidate.source_lane === "lexical" ? 0.03 : 0;
        const primaryScore = candidate.score + domainBoost + evidenceBoost + laneBoost;
        return {
          ...candidate,
          primary_score: Number(primaryScore.toFixed(12)),
          final_score: Number(primaryScore.toFixed(12)),
          rank_reason: [
            `base=${candidate.score.toFixed(6)}`,
            `domainBoost=${domainBoost.toFixed(3)}`,
            `evidenceBoost=${evidenceBoost.toFixed(3)}`,
            `laneBoost=${laneBoost.toFixed(3)}`
          ]
        };
      })
      .sort((left, right) => {
        if (right.primary_score !== left.primary_score) {
          return right.primary_score - left.primary_score;
        }
        return left.chunk_id.localeCompare(right.chunk_id);
      });
  }

  private async runSecondaryRerank(
    bundle: RagRetrievalBundle,
    candidates: RagRerankedCandidate[],
    modelCatalogId?: string
  ): Promise<Record<string, { score: number; reason: string }>> {
    const response = await this.modelReranker.rerank({
      query: bundle.query,
      modelCatalogId,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.chunk_id,
        content: candidate.chunk.content,
        domain: candidate.chunk.metadata.domain,
        sourceLane: candidate.source_lane,
        evidence: candidate.evidence,
        baseScore: candidate.primary_score
      }))
    });
    const scoreMap: Record<string, { score: number; reason: string }> = {};
    for (const item of response) {
      if (!Number.isFinite(item.score)) {
        continue;
      }
      scoreMap[item.candidateId] = {
        score: Math.max(0, Math.min(1, Number(item.score.toFixed(6)))),
        reason: item.reason
      };
    }
    return scoreMap;
  }

  private mergePrimaryWithSecondary(
    primary: RagRerankedCandidate[],
    secondaryScores: Record<string, { score: number; reason: string }>
  ): RagRerankedCandidate[] {
    return primary
      .map((candidate) => {
        const secondary = secondaryScores[candidate.chunk_id];
        if (!secondary) {
          return candidate;
        }
        const finalScore = candidate.primary_score * 0.7 + secondary.score * 0.3;
        return {
          ...candidate,
          secondary_score: secondary.score,
          final_score: Number(finalScore.toFixed(12)),
          rank_reason: [...candidate.rank_reason, `secondary=${secondary.reason}`]
        };
      })
      .sort((left, right) => {
        if (right.final_score !== left.final_score) {
          return right.final_score - left.final_score;
        }
        return left.chunk_id.localeCompare(right.chunk_id);
      });
  }

  private domainBoost(domain: string): number {
    if (domain === "semantic_term") {
      return 0.15;
    }
    if (domain === "schema") {
      return 0.1;
    }
    if (domain === "sql_example") {
      return 0.08;
    }
    return 0.05;
  }

  private buildRiskTags(input: {
    degradeReasons: string[];
    reranked: RagRerankedCandidate[];
  }): string[] {
    const tags: string[] = [];
    if (input.degradeReasons.some((reason) => reason.includes("zero_recall"))) {
      tags.push("rag_zero_recall");
    }
    if (input.degradeReasons.some((reason) => reason.includes("secondary_rerank"))) {
      tags.push("rerank_degraded");
    }
    if (!input.reranked.some((item) => item.chunk.metadata.domain === "semantic_term")) {
      tags.push("semantic_context_missing");
    }
    return this.unique(tags);
  }

  private async withTimeout<T>(
    task: Promise<T>,
    timeoutMs: number,
    timeoutReason: string
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(timeoutReason)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async writePrimaryReplay(
    bundle: RagRetrievalBundle,
    primary: RagRerankedCandidate[]
  ): Promise<void> {
    await this.replayRepository.writeReplay({
      runId: bundle.run_id,
      replayKey: "rerank:primary",
      datasourceId: bundle.datasource_id,
      stage: "rerank_primary",
      indexVersionId: bundle.index_version_id,
      payload: {
        candidateCount: primary.length,
        scores: primary.map((item) => ({
          chunkId: item.chunk_id,
          primaryScore: item.primary_score,
          finalScore: item.final_score
        }))
      }
    });
  }

  private async writeSecondaryReplay(
    bundle: RagRetrievalBundle,
    input: {
      status: "ok" | "degraded" | "skipped";
      reason?: string;
      timeoutMs: number;
      scores?: Record<string, { score: number; reason: string }>;
    }
  ): Promise<void> {
    await this.replayRepository.writeReplay({
      runId: bundle.run_id,
      replayKey: "rerank:secondary",
      datasourceId: bundle.datasource_id,
      stage: "rerank_secondary",
      indexVersionId: bundle.index_version_id,
      payload: {
        status: input.status,
        reason: input.reason,
        timeoutMs: input.timeoutMs,
        scores: input.scores
      }
    });
  }

  private async writeFinalReplay(bundle: RagRetrievalBundle): Promise<void> {
    await this.replayRepository.writeReplay({
      runId: bundle.run_id,
      replayKey: "rerank:final",
      datasourceId: bundle.datasource_id,
      stage: "rerank_finalized",
      indexVersionId: bundle.index_version_id,
      payload: {
        status: bundle.status,
        degradeReasons: bundle.degrade_reasons,
        decisionReasons: bundle.decision_reasons ?? [],
        rerankedCount: bundle.reranked?.length ?? 0,
        selectedContextCount: bundle.selected_context?.length ?? 0,
        riskTags: bundle.risk_tags ?? [],
        columnPruning: this.readColumnPruningEvidence(bundle),
        contextPack: bundle.context_pack
          ? {
              status: bundle.context_pack.status,
              semanticVersion: bundle.context_pack.semantic_version,
              semanticLockStatus: bundle.context_pack.semantic_lock_status,
              instructionSummary: {
                modelBindingCount:
                  bundle.context_pack.instruction_sets.model_bindings.length,
                relationshipBindingCount:
                  bundle.context_pack.instruction_sets.relationship_bindings.length,
                metricBindingCount:
                  bundle.context_pack.instruction_sets.metric_bindings.length,
                calculatedFieldBindingCount:
                  bundle.context_pack.instruction_sets.calculated_field_bindings.length
              },
              degradeReasons: bundle.context_pack.degrade_reasons
            }
          : undefined
      }
    });
  }

  private async writeBudgetReplay(
    bundle: RagRetrievalBundle,
    input: {
      decisionReasons: string[];
      secondaryEnabled: boolean;
      secondaryTopK: number;
    }
  ): Promise<void> {
    await this.replayRepository.writeReplay({
      runId: bundle.run_id,
      replayKey: "rerank:budget",
      datasourceId: bundle.datasource_id,
      stage: "rerank_budget",
      indexVersionId: bundle.index_version_id,
      payload: {
        decisionReasons: input.decisionReasons,
        secondaryEnabled: input.secondaryEnabled,
        secondaryTopK: input.secondaryTopK
      }
    });
  }

  private readColumnPruningEvidence(
    bundle: RagRetrievalBundle
  ): Record<string, unknown> | undefined {
    const record = bundle as RagRetrievalBundle & {
      column_pruning?: unknown;
      columnPruning?: unknown;
    };
    const candidate = record.column_pruning ?? record.columnPruning;
    return this.isRecord(candidate) ? candidate : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private normalizePositiveInt(value: number | undefined, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.floor(value);
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }
}
