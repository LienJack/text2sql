import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { RagReplayRepository } from "../observability/rag-replay.repository";
import { RagBudgetPolicy } from "../perf/rag-budget-policy";
import { RagCacheKeyFactory } from "../perf/rag-cache-key.factory";
import { RagQueryCacheService } from "../perf/rag-query-cache.service";
import { RagQualityService } from "../quality/rag-quality.service";
import {
  type RagBudgetSignal,
  type RagRerankStageMetadata,
  type RagRetrievalBundle,
  type RagRetrievalCandidate,
  type RagRetrievalChunkPayload,
  type RagRerankedCandidate
} from "../retrieval/rag-retrieval.types";
import { ModelRerankerAdapter } from "./model-reranker.adapter";

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

interface SecondaryRerankExecution {
  scores: Record<string, { score: number; reason: string }>;
  metadata: RagRerankStageMetadata;
}

interface RerankContextPackLaneMetadata {
  lane: "rerank";
  state: "ready" | "degraded" | "unavailable" | "skipped";
  provider?: string;
  model?: string;
  input_count?: number;
  output_count?: number;
  selected_count?: number;
  timeout_ms?: number;
  unavailable_reason?: string;
  fallback_reason?: string;
  evidence_ids?: string[];
  reason_codes?: string[];
  inputCount?: number;
  outputCount?: number;
  selectedCount?: number;
  timeoutMs?: number;
  unavailableReason?: string;
  fallbackReason?: string;
  evidenceIds?: string[];
  reasonCodes?: string[];
}

interface RerankContextPackPruningDecision {
  budget_source: "rerank_budget";
  removed_evidence_ids: string[];
  kept_evidence_ids: string[];
  reason_codes: string[];
  summary?: string;
  budgetSource?: "rerank_budget";
  removedEvidenceIds?: string[];
  keptEvidenceIds?: string[];
  reasonCodes?: string[];
}

interface ExtendedRagContextPack extends NonNullable<RagRetrievalBundle["context_pack"]> {
  lane_metadata?: RerankContextPackLaneMetadata[];
  laneMetadata?: RerankContextPackLaneMetadata[];
  pruning_decisions?: RerankContextPackPruningDecision[];
  pruningDecisions?: RerankContextPackPruningDecision[];
  selected_context_lanes?: string[];
  selectedContextLanes?: string[];
}

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
    const candidateWindow = primary.slice(0, secondaryTopK);
    let secondaryMetadata: RagRerankStageMetadata = {
      status: "skipped",
      timeout_ms: secondaryTimeoutMs,
      timeoutMs: secondaryTimeoutMs,
      input_count: candidateWindow.length,
      inputCount: candidateWindow.length,
      output_count: 0,
      outputCount: 0
    };

    if (!budgetDecision.secondaryEnabled) {
      const reason = "secondary_rerank_disabled_by_budget";
      rerankDegradeReasons.push(reason);
      secondaryMetadata = {
        ...secondaryMetadata,
        status: "skipped",
        fallback_reason: reason,
        fallbackReason: reason
      };
      await this.writeSecondaryReplay(bundle, {
        status: "skipped",
        reason,
        timeoutMs: secondaryTimeoutMs,
        metadata: secondaryMetadata
      });
    } else if (!secondaryEnabled) {
      const reason = "secondary_rerank_disabled";
      rerankDegradeReasons.push(reason);
      secondaryMetadata = {
        ...secondaryMetadata,
        status: "skipped",
        fallback_reason: reason,
        fallbackReason: reason
      };
      await this.writeSecondaryReplay(bundle, {
        status: "skipped",
        reason,
        timeoutMs: secondaryTimeoutMs,
        metadata: secondaryMetadata
      });
    } else if (primary.length < secondaryMinCandidates) {
      const reason = "secondary_rerank_skipped_low_candidates";
      rerankDegradeReasons.push(reason);
      secondaryMetadata = {
        ...secondaryMetadata,
        status: "skipped",
        fallback_reason: reason,
        fallbackReason: reason,
        evidence_ids: candidateWindow.map((item) => item.chunk_id),
        evidenceIds: candidateWindow.map((item) => item.chunk_id)
      };
      await this.writeSecondaryReplay(bundle, {
        status: "skipped",
        reason,
        timeoutMs: secondaryTimeoutMs,
        metadata: secondaryMetadata
      });
    } else {
      try {
        const secondary = await this.withTimeout(
          this.runSecondaryRerank(bundle, candidateWindow, input.modelCatalogId),
          secondaryTimeoutMs,
          "secondary_rerank_timeout"
        );
        secondaryScores = secondary.scores;
        secondaryMetadata = {
          ...secondary.metadata,
          status: "ok",
          timeout_ms: secondaryTimeoutMs,
          timeoutMs: secondaryTimeoutMs
        };
        await this.writeSecondaryReplay(bundle, {
          status: "ok",
          timeoutMs: secondaryTimeoutMs,
          scores: secondaryScores,
          metadata: secondaryMetadata
        });
      } catch (error) {
        const reason = this.resolveSecondaryDegradeReason(error);
        rerankDegradeReasons.push(reason);
        secondaryMetadata = this.toSecondaryMetadataFromError({
          error,
          reason,
          timeoutMs: secondaryTimeoutMs,
          evidenceIds: candidateWindow.map((item) => item.chunk_id),
          inputCount: candidateWindow.length
        });
        await this.writeSecondaryReplay(bundle, {
          status: "degraded",
          reason,
          timeoutMs: secondaryTimeoutMs,
          metadata: secondaryMetadata
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
      ]),
      rerank_metadata: {
        secondary: secondaryMetadata,
        secondaryCompat: secondaryMetadata
      },
      rerankMetadata: {
        secondary: secondaryMetadata,
        secondaryCompat: secondaryMetadata
      }
    };
    const existingContextPack = bundle.context_pack;
    const existingContextPackExtended = this.toExtendedContextPack(existingContextPack);
    const existingLaneMetadata =
      existingContextPackExtended?.lane_metadata ??
      existingContextPackExtended?.laneMetadata ??
      [];
    const existingPruningDecisions =
      existingContextPackExtended?.pruning_decisions ??
      existingContextPackExtended?.pruningDecisions ??
      [];
    const rerankLaneMetadata = this.buildRerankLaneMetadata({
      secondaryMetadata,
      selectedContext
    });
    const mergedLaneMetadata = [
      ...existingLaneMetadata.filter((lane) => lane.lane !== "rerank"),
      rerankLaneMetadata
    ];
    const removedBySelectedContextLimit = reranked
      .slice(selectedContext.length)
      .map((candidate) => candidate.chunk_id);
    const mergedPruningDecisions = this.mergePruningDecisions({
      existingPruningDecisions,
      decisionReasons: budgetDecision.decisionReasons,
      selectedContext,
      removedBySelectedContextLimit
    });
    const selectedContextLanes = this.unique(selectedContext.map((chunk) => chunk.metadata.domain));
    const nextContextPack: ExtendedRagContextPack = {
      status: responseBundle.status,
      semantic_version: existingContextPack?.semantic_version,
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
      lane_metadata: mergedLaneMetadata,
      laneMetadata: mergedLaneMetadata,
      pruning_decisions: mergedPruningDecisions,
      pruningDecisions: mergedPruningDecisions,
      selected_context_lanes: selectedContextLanes,
      selectedContextLanes: selectedContextLanes,
      degrade_reasons: this.unique([
        ...(existingContextPack?.degrade_reasons ?? []),
        ...degradeReasons
      ]),
      risk_tags: this.unique([
        ...(existingContextPack?.risk_tags ?? []),
        ...(responseBundle.risk_tags ?? [])
      ])
    };
    responseBundle.context_pack = nextContextPack;
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
  ): Promise<SecondaryRerankExecution> {
    const response = await this.modelReranker.rerankWithMetadata({
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
    for (const item of response.results) {
      if (!Number.isFinite(item.score)) {
        continue;
      }
      scoreMap[item.candidateId] = {
        score: Math.max(0, Math.min(1, Number(item.score.toFixed(6)))),
        reason: item.reason
      };
    }
    const expectedCandidateIds = new Set(candidates.map((candidate) => candidate.chunk_id));
    const returnedCandidateIds = Object.keys(scoreMap);
    const unknownCandidateIds = returnedCandidateIds.filter(
      (candidateId) => !expectedCandidateIds.has(candidateId)
    );
    const missingCandidateIds = candidates
      .map((candidate) => candidate.chunk_id)
      .filter((candidateId) => !returnedCandidateIds.includes(candidateId));
    if (unknownCandidateIds.length > 0 || missingCandidateIds.length > 0) {
      throw new DomainError(
        "RERANK_PROVIDER_OUTPUT_CANDIDATE_MISMATCH",
        "Rerank provider 返回候选集合与输入不一致。",
        502,
        {
          provider: response.metadata.provider,
          model: response.metadata.model,
          unknownCandidateIds: unknownCandidateIds.slice(0, 20),
          missingCandidateIds: missingCandidateIds.slice(0, 20),
          expected: candidates.length,
          actual: returnedCandidateIds.length
        }
      );
    }
    if (Object.keys(scoreMap).length !== candidates.length) {
      throw new DomainError(
        "RERANK_PROVIDER_OUTPUT_COUNT_MISMATCH",
        "Rerank provider 返回结果数量与候选数量不一致。",
        502,
        {
          provider: response.metadata.provider,
          model: response.metadata.model,
          expected: candidates.length,
          actual: Object.keys(scoreMap).length
        }
      );
    }
    const evidenceIds = candidates.map((candidate) => candidate.chunk_id);
    const metadata: RagRerankStageMetadata = {
      status: "ok",
      mode: response.metadata.mode,
      provider: response.metadata.provider,
      model: response.metadata.model,
      config_source: response.metadata.configSource,
      configSource: response.metadata.configSource,
      config_id: response.metadata.configId,
      configId: response.metadata.configId,
      input_count: response.metadata.inputCount,
      inputCount: response.metadata.inputCount,
      output_count: Object.keys(scoreMap).length,
      outputCount: Object.keys(scoreMap).length,
      fallback_reason: response.metadata.fallbackReason,
      fallbackReason: response.metadata.fallbackReason,
      unavailable_reason: response.metadata.unavailableReason,
      unavailableReason: response.metadata.unavailableReason,
      evidence_ids: evidenceIds,
      evidenceIds
    };
    return {
      scores: scoreMap,
      metadata
    };
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

  private buildRerankLaneMetadata(input: {
    secondaryMetadata: RagRerankStageMetadata;
    selectedContext: RagRetrievalChunkPayload[];
  }): RerankContextPackLaneMetadata {
    const unavailableReason =
      input.secondaryMetadata.unavailable_reason ?? input.secondaryMetadata.unavailableReason;
    const fallbackReason =
      input.secondaryMetadata.fallback_reason ?? input.secondaryMetadata.fallbackReason;
    const state: RerankContextPackLaneMetadata["state"] =
      input.secondaryMetadata.status === "ok"
        ? "ready"
        : unavailableReason
          ? "unavailable"
          : input.secondaryMetadata.status === "skipped"
            ? "skipped"
            : "degraded";
    const evidenceIds =
      input.secondaryMetadata.evidence_ids ?? input.secondaryMetadata.evidenceIds ?? [];
    const reasonCodes = this.unique([
      ...(unavailableReason ? [unavailableReason] : []),
      ...(fallbackReason ? [fallbackReason] : [])
    ]);
    return {
      lane: "rerank",
      state,
      provider: input.secondaryMetadata.provider,
      model: input.secondaryMetadata.model,
      input_count: input.secondaryMetadata.input_count ?? input.secondaryMetadata.inputCount ?? 0,
      inputCount: input.secondaryMetadata.input_count ?? input.secondaryMetadata.inputCount ?? 0,
      output_count: input.secondaryMetadata.output_count ?? input.secondaryMetadata.outputCount ?? 0,
      outputCount:
        input.secondaryMetadata.output_count ?? input.secondaryMetadata.outputCount ?? 0,
      selected_count: input.selectedContext.length,
      selectedCount: input.selectedContext.length,
      timeout_ms: input.secondaryMetadata.timeout_ms ?? input.secondaryMetadata.timeoutMs,
      timeoutMs: input.secondaryMetadata.timeout_ms ?? input.secondaryMetadata.timeoutMs,
      unavailable_reason: unavailableReason,
      unavailableReason: unavailableReason,
      fallback_reason: fallbackReason,
      fallbackReason: fallbackReason,
      evidence_ids: evidenceIds,
      evidenceIds: evidenceIds,
      reason_codes: reasonCodes,
      reasonCodes: reasonCodes
    };
  }

  private mergePruningDecisions(input: {
    existingPruningDecisions: RerankContextPackPruningDecision[];
    decisionReasons: string[];
    selectedContext: RagRetrievalChunkPayload[];
    removedBySelectedContextLimit: string[];
  }): RerankContextPackPruningDecision[] {
    const next = [...input.existingPruningDecisions];
    if (
      input.removedBySelectedContextLimit.length === 0 &&
      input.decisionReasons.length === 0
    ) {
      return next;
    }
    const reasonCodes = this.unique([
      ...input.decisionReasons,
      ...(input.removedBySelectedContextLimit.length > 0
        ? ["selected_context_limit_applied"]
        : [])
    ]);
    next.push({
      budget_source: "rerank_budget",
      removed_evidence_ids: input.removedBySelectedContextLimit,
      kept_evidence_ids: input.selectedContext.map((chunk) => chunk.chunk_id),
      reason_codes: reasonCodes,
      summary: `rerank_budget:selected_context_limit=${input.selectedContext.length}`,
      budgetSource: "rerank_budget",
      removedEvidenceIds: input.removedBySelectedContextLimit,
      keptEvidenceIds: input.selectedContext.map((chunk) => chunk.chunk_id),
      reasonCodes: reasonCodes
    });
    return next;
  }

  private toExtendedContextPack(
    contextPack: RagRetrievalBundle["context_pack"]
  ): ExtendedRagContextPack | undefined {
    if (!contextPack) {
      return undefined;
    }
    return contextPack as ExtendedRagContextPack;
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
      metadata?: RagRerankStageMetadata;
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
        scores: input.scores,
        metadata: input.metadata
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
        rerankMetadata: bundle.rerank_metadata ?? bundle.rerankMetadata,
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

  private resolveSecondaryDegradeReason(error: unknown): string {
    if (error instanceof Error && error.message === "secondary_rerank_timeout") {
      return "secondary_rerank_timeout";
    }
    const code = this.readErrorCode(error);
    if (code === "LLM_CONFIG_MISSING") {
      return "secondary_rerank_unavailable_provider_config_missing";
    }
    if (code === "RERANK_PROVIDER_INVALID_PAYLOAD") {
      return "secondary_rerank_unavailable_invalid_payload";
    }
    if (typeof code === "string" && code.trim().length > 0) {
      return `secondary_rerank_unavailable_${code.toLowerCase()}`;
    }
    if (error instanceof Error && error.message.trim()) {
      return `secondary_rerank_unavailable_${error.message
        .toLowerCase()
        .replace(/\s+/g, "_")
        .slice(0, 64)}`;
    }
    return "secondary_rerank_unavailable_unknown";
  }

  private toSecondaryMetadataFromError(input: {
    error: unknown;
    reason: string;
    timeoutMs: number;
    evidenceIds: string[];
    inputCount: number;
  }): RagRerankStageMetadata {
    const details = this.readErrorDetails(input.error);
    const provider = this.readString(details?.provider);
    const model = this.readString(details?.model);
    return {
      status: "degraded",
      provider,
      model,
      timeout_ms: input.timeoutMs,
      timeoutMs: input.timeoutMs,
      input_count: input.inputCount,
      inputCount: input.inputCount,
      output_count: 0,
      outputCount: 0,
      unavailable_reason: input.reason,
      unavailableReason: input.reason,
      evidence_ids: input.evidenceIds,
      evidenceIds: input.evidenceIds
    };
  }

  private readErrorCode(error: unknown): string | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }
    return this.readString(error.code);
  }

  private readErrorDetails(error: unknown): Record<string, unknown> | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }
    if (!this.isRecord(error.details)) {
      return undefined;
    }
    return error.details;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
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
