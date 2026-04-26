import { Inject, Injectable } from "@nestjs/common";
import type { ContextEnvelopePinningEvidence } from "@text2sql/shared-types";
import { AppConfigService } from "../../../config/app-config.service";
import {
  KNOWLEDGE_RAG_CONTRACT,
  type KnowledgeRagContract
} from "../../../knowledge/contracts/knowledge-rag.contract";
import type {
  RagRetrievalChunkPayload,
  RagContextPack,
  RagRetrievalBundle
} from "../../../knowledge/rag/retrieval/rag-retrieval.types";

export interface RetrievedKnowledge {
  status: "ready" | "degraded";
  snippets: string[];
  summary: string;
  retrievalBundle?: RagRetrievalBundle;
  contextPack?: RagContextPack;
  pinning?: ContextEnvelopePinningEvidence;
}

interface RetrievalPinningConfig {
  enabled: boolean;
  pinnedTables: Set<string>;
  pinnedColumns: Set<string>;
}

interface RetrievalPinningResult {
  bundle: RagRetrievalBundle;
  pinning: ContextEnvelopePinningEvidence;
}

@Injectable()
export class RetrieveKnowledgeNode {
  constructor(
    private readonly appConfig: AppConfigService,
    @Inject(KNOWLEDGE_RAG_CONTRACT)
    private readonly ragContract: KnowledgeRagContract
  ) {}

  async run(input: {
    question: string;
    datasourceId: string;
    runId: string;
    workspaceId?: string;
    allowedTables?: string[];
    modelCatalogId?: string;
    pinnedTables?: string[];
    pinnedColumns?: string[];
  }): Promise<RetrievedKnowledge> {
    const question = input.question.trim();
    const datasourceId = input.datasourceId.trim();
    const runId = input.runId.trim();
    const pinningConfig = this.normalizePinningConfig({
      pinnedTables: input.pinnedTables,
      pinnedColumns: input.pinnedColumns
    });

    const normalized = question.trim();
    if (!normalized) {
      return this.createDisabledKnowledge({
        query: question,
        datasourceId,
        runId,
        pinningConfig,
        degradeReason: "empty_question",
        summary: "检索输入为空，已降级到最小执行路径。"
      });
    }

    if (!this.appConfig.agentRagRetrievalEnabled) {
      return this.createDisabledKnowledge({
        query: normalized,
        datasourceId,
        runId,
        pinningConfig,
        degradeReason: "rag_retrieval_disabled",
        summary: "RAG 检索开关已关闭，已降级到最小执行路径。"
      });
    }

    const retrieved = await this.ragContract.retrieval.retrieve({
      query: normalized,
      datasourceId,
      workspaceId: input.workspaceId,
      allowedTables: input.allowedTables,
      runId
    });
    const reranked = await this.ragContract.rerank.rerank({
      retrievalBundle: retrieved.retrieval_bundle,
      modelCatalogId: input.modelCatalogId
    });
    const pinningResult = this.applyPinningConstraints(
      reranked.retrieval_bundle,
      pinningConfig
    );
    const bundle = pinningResult.bundle;
    const pinningSummary =
      pinningResult.pinning.enabled && pinningResult.pinning.status === "applied"
        ? `，pinning[candidates=${pinningResult.pinning.candidateFilteredCount ?? 0},selected=${pinningResult.pinning.selectedContextFilteredCount ?? 0}]`
        : "";
    const priorSqlLane = bundle.prior_sql_lane ?? bundle.priorSqlLane;
    const priorSqlHitCount = priorSqlLane?.selected_count ?? priorSqlLane?.selectedCount ?? 0;
    const snippets = (bundle.selected_context ?? bundle.candidates.map((item) => item.chunk))
      .slice(0, 3)
      .map((item) => item.content.slice(0, 200));
    const denseState = this.resolveLaneState(bundle, "dense");
    const rerankState = this.resolveRerankState(bundle);
    const pruningSummary = this.summarizePruning(bundle);
    const laneSummary = `dense=${denseState},rerank=${rerankState}`;

    return {
      status: bundle.status,
      snippets,
      summary:
        bundle.status === "ready"
          ? `检索与重排完成，候选=${bundle.candidates.length}，上下文=${bundle.selected_context?.length ?? 0}，priorSQL=${priorSqlHitCount}，${laneSummary}${pruningSummary}${pinningSummary}。`
          : `检索链路降级执行，原因=${bundle.degrade_reasons.join(", ") || "unknown"}，priorSQL=${priorSqlHitCount}，${laneSummary}${pruningSummary}${pinningSummary}。`,
      retrievalBundle: bundle,
      contextPack: bundle.context_pack,
      pinning: pinningResult.pinning
    };
  }

  private normalizePinningConfig(input: {
    pinnedTables?: string[];
    pinnedColumns?: string[];
  }): RetrievalPinningConfig {
    const pinnedTables = this.toNormalizedSet(input.pinnedTables);
    const pinnedColumns = this.toNormalizedSet(input.pinnedColumns);
    return {
      enabled: pinnedTables.size > 0 || pinnedColumns.size > 0,
      pinnedTables,
      pinnedColumns
    };
  }

  private createDisabledKnowledge(input: {
    query: string;
    datasourceId: string;
    runId: string;
    pinningConfig: RetrievalPinningConfig;
    degradeReason: string;
    summary: string;
  }): RetrievedKnowledge {
    const retrievalBundle = this.buildDegradedBundle({
      query: input.query,
      datasourceId: input.datasourceId,
      runId: input.runId,
      degradeReason: input.degradeReason
    });
    return {
      status: "degraded",
      snippets: [],
      summary: input.summary,
      retrievalBundle,
      contextPack: retrievalBundle.context_pack,
      pinning: {
        enabled: input.pinningConfig.enabled,
        status: "inactive",
        candidateFilteredCount: 0,
        selectedContextFilteredCount: 0
      }
    };
  }

  private buildDegradedBundle(input: {
    query: string;
    datasourceId: string;
    runId: string;
    degradeReason: string;
  }): RagRetrievalBundle {
    return {
      query: input.query,
      run_id: input.runId,
      datasource_id: input.datasourceId,
      status: "degraded",
      degrade_reasons: [input.degradeReason],
      lane_results: {
        lexical: {
          lane: "lexical",
          status: "degraded",
          timeout_ms: 0,
          elapsed_ms: 0,
          degrade_reason: input.degradeReason,
          hits: []
        },
        dense: {
          lane: "dense",
          status: "degraded",
          timeout_ms: 0,
          elapsed_ms: 0,
          degrade_reason: input.degradeReason,
          hits: []
        },
        graph: {
          lane: "graph",
          status: "degraded",
          timeout_ms: 0,
          elapsed_ms: 0,
          degrade_reason: input.degradeReason,
          hits: []
        }
      },
      candidates: [],
      reranked: [],
      selected_context: [],
      risk_tags: ["rag_zero_recall", input.degradeReason],
      lane_metadata: [
        {
          lane: "dense",
          state: "unavailable",
          unavailable_reason: input.degradeReason,
          reason_codes: [input.degradeReason]
        },
        {
          lane: "rerank",
          state: "skipped",
          fallback_reason: input.degradeReason,
          reason_codes: [input.degradeReason]
        }
      ],
      pruning_decisions: [
        {
          budget_source: "context_pack",
          removed_evidence_ids: [],
          kept_evidence_ids: [],
          reason_codes: [input.degradeReason],
          summary: `context_pack:disabled:${input.degradeReason}`
        }
      ],
      context_pack: {
        status: "degraded",
        semantic_lock_status: "degraded",
        semantic_bindings: {
          model_keys: [],
          relationship_keys: [],
          metric_keys: [],
          calculated_field_keys: []
        },
        instruction_sets: {
          model_bindings: [],
          relationship_bindings: [],
          metric_bindings: [],
          calculated_field_bindings: []
        },
        selected_context_summary: {
          count: 0,
          snippets: []
        },
        lane_metadata: [
          {
            lane: "dense",
            state: "unavailable",
            unavailable_reason: input.degradeReason,
            reason_codes: [input.degradeReason]
          },
          {
            lane: "rerank",
            state: "skipped",
            fallback_reason: input.degradeReason,
            reason_codes: [input.degradeReason]
          }
        ],
        pruning_decisions: [
          {
            budget_source: "context_pack",
            removed_evidence_ids: [],
            kept_evidence_ids: [],
            reason_codes: [input.degradeReason],
            summary: `context_pack:disabled:${input.degradeReason}`
          }
        ],
        selected_context_lanes: [],
        degrade_reasons: [input.degradeReason],
        risk_tags: ["semantic_spine_degraded", input.degradeReason]
      }
    };
  }

  private applyPinningConstraints(
    bundle: RagRetrievalBundle,
    pinningConfig: RetrievalPinningConfig
  ): RetrievalPinningResult {
    if (!pinningConfig.enabled) {
      return {
        bundle,
        pinning: {
          enabled: false,
          status: "inactive",
          candidateFilteredCount: 0,
          selectedContextFilteredCount: 0
        }
      };
    }

    const filteredCandidates = bundle.candidates.filter((candidate) =>
      this.matchesPinning(candidate.chunk, pinningConfig)
    );
    const allowedCandidateChunkIds = new Set(
      filteredCandidates.map((candidate) => candidate.chunk_id)
    );
    const filteredSelectedContext = (bundle.selected_context ?? []).filter((chunk) =>
      this.matchesPinning(chunk, pinningConfig)
    );
    const filteredReranked = bundle.reranked?.filter((candidate) =>
      allowedCandidateChunkIds.has(candidate.chunk_id)
    );
    const candidateFilteredCount = Math.max(0, bundle.candidates.length - filteredCandidates.length);
    const selectedContextFilteredCount = Math.max(
      0,
      (bundle.selected_context?.length ?? 0) - filteredSelectedContext.length
    );
    const removedEvidenceIds = (bundle.selected_context ?? [])
      .map((chunk) => chunk.chunk_id)
      .filter((chunkId) => !filteredSelectedContext.some((chunk) => chunk.chunk_id === chunkId));

    const nextBundle: RagRetrievalBundle = {
      ...bundle,
      candidates: filteredCandidates,
      selected_context: filteredSelectedContext,
      ...(filteredReranked
        ? {
            reranked: filteredReranked
          }
        : {}),
      context_pack: this.withPinnedContextPack(
        bundle.context_pack,
        filteredSelectedContext,
        removedEvidenceIds
      )
    };

    return {
      bundle: nextBundle,
      pinning: {
        enabled: true,
        status: "applied",
        candidateFilteredCount,
        selectedContextFilteredCount
      }
    };
  }

  private withPinnedContextPack(
    contextPack: RagContextPack | undefined,
    selectedContext: RagRetrievalChunkPayload[],
    removedEvidenceIds: string[]
  ): RagContextPack | undefined {
    if (!contextPack) {
      return contextPack;
    }
    const existingPruningDecisions =
      contextPack.pruning_decisions ?? contextPack.pruningDecisions ?? [];
    const pinningDecision =
      removedEvidenceIds.length > 0
        ? [
            {
              budget_source: "context_pack" as const,
              removed_evidence_ids: removedEvidenceIds,
              kept_evidence_ids: selectedContext.map((chunk) => chunk.chunk_id),
              reason_codes: ["pinning_filter_applied"],
              summary: `context_pack:pinning_removed=${removedEvidenceIds.length}`
            }
          ]
        : [];
    return {
      ...contextPack,
      selected_context_summary: {
        ...contextPack.selected_context_summary,
        count: selectedContext.length,
        snippets: selectedContext.map((chunk) => chunk.content.slice(0, 200))
      },
      pruning_decisions: [...existingPruningDecisions, ...pinningDecision],
      pruningDecisions: [...existingPruningDecisions, ...pinningDecision]
    };
  }

  private matchesPinning(
    chunk: RagRetrievalChunkPayload,
    pinningConfig: RetrievalPinningConfig
  ): boolean {
    if (pinningConfig.pinnedTables.size > 0) {
      const tableNames = chunk.metadata.tableNames.map((item) => item.trim().toLowerCase());
      const tableMatched = tableNames.some((name) => pinningConfig.pinnedTables.has(name));
      if (!tableMatched) {
        return false;
      }
    }
    if (pinningConfig.pinnedColumns.size > 0) {
      const columnNames = chunk.metadata.columnNames.map((item) => item.trim().toLowerCase());
      const columnMatched = columnNames.some((name) => pinningConfig.pinnedColumns.has(name));
      if (!columnMatched) {
        return false;
      }
    }
    return true;
  }

  private resolveLaneState(bundle: RagRetrievalBundle, lane: "dense" | "lexical" | "graph"): string {
    const laneMetadata = bundle.context_pack?.lane_metadata ?? bundle.context_pack?.laneMetadata ?? [];
    const metadataState = laneMetadata.find((item) => item.lane === lane)?.state;
    if (metadataState && metadataState.trim().length > 0) {
      return metadataState;
    }
    const laneResult = bundle.lane_results[lane];
    if (laneResult.status === "ok") {
      return "ready";
    }
    if ((laneResult.degrade_reason ?? "").includes("unavailable")) {
      return "unavailable";
    }
    return "degraded";
  }

  private resolveRerankState(bundle: RagRetrievalBundle): string {
    const laneMetadata = bundle.context_pack?.lane_metadata ?? bundle.context_pack?.laneMetadata ?? [];
    const rerankLane = laneMetadata.find((item) => item.lane === "rerank");
    if (rerankLane?.state) {
      return rerankLane.state;
    }
    const secondary = bundle.rerank_metadata?.secondary ?? bundle.rerankMetadata?.secondary;
    if (!secondary) {
      return "skipped";
    }
    if (secondary.status === "ok") {
      return "ready";
    }
    if (secondary.unavailable_reason || secondary.unavailableReason) {
      return "unavailable";
    }
    return secondary.status;
  }

  private summarizePruning(bundle: RagRetrievalBundle): string {
    const pruningDecisions =
      bundle.context_pack?.pruning_decisions ??
      bundle.context_pack?.pruningDecisions ??
      bundle.pruning_decisions ??
      bundle.pruningDecisions ??
      [];
    if (pruningDecisions.length === 0) {
      return "";
    }
    const reasonCount = pruningDecisions.reduce(
      (total, decision) => total + (decision.reason_codes?.length ?? decision.reasonCodes?.length ?? 0),
      0
    );
    return `,pruning[decisions=${pruningDecisions.length},reasons=${reasonCount}]`;
  }

  private toNormalizedSet(values?: string[]): Set<string> {
    if (!Array.isArray(values) || values.length === 0) {
      return new Set<string>();
    }
    return new Set(
      values
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0)
    );
  }
}
