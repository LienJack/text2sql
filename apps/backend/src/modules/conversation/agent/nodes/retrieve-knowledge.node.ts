import { Inject, Injectable } from "@nestjs/common";
import type { ContextEnvelopePinningEvidence } from "@text2sql/shared-types";
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
      return {
        status: "degraded",
        snippets: [],
        summary: "检索输入为空，已降级到最小执行路径。",
        retrievalBundle: {
          query: question,
          run_id: runId,
          datasource_id: datasourceId,
          status: "degraded",
          degrade_reasons: ["empty_question"],
          lane_results: {
            lexical: {
              lane: "lexical",
              status: "degraded",
              timeout_ms: 0,
              elapsed_ms: 0,
              degrade_reason: "empty_question",
              hits: []
            },
            dense: {
              lane: "dense",
              status: "degraded",
              timeout_ms: 0,
              elapsed_ms: 0,
              degrade_reason: "empty_question",
              hits: []
            },
            graph: {
              lane: "graph",
              status: "degraded",
              timeout_ms: 0,
              elapsed_ms: 0,
              degrade_reason: "empty_question",
              hits: []
            }
          },
          candidates: [],
          reranked: [],
          selected_context: [],
          risk_tags: ["rag_zero_recall"],
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
            degrade_reasons: ["empty_question"],
            risk_tags: ["semantic_spine_degraded"]
          }
        },
        pinning: {
          enabled: pinningConfig.enabled,
          status: "inactive",
          candidateFilteredCount: 0,
          selectedContextFilteredCount: 0
        }
      };
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

    return {
      status: bundle.status,
      snippets,
      summary:
        bundle.status === "ready"
          ? `检索与重排完成，候选=${bundle.candidates.length}，上下文=${bundle.selected_context?.length ?? 0}，priorSQL=${priorSqlHitCount}${pinningSummary}。`
          : `检索链路降级执行，原因=${bundle.degrade_reasons.join(", ") || "unknown"}，priorSQL=${priorSqlHitCount}${pinningSummary}。`,
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

    const nextBundle: RagRetrievalBundle = {
      ...bundle,
      candidates: filteredCandidates,
      selected_context: filteredSelectedContext,
      ...(filteredReranked
        ? {
            reranked: filteredReranked
          }
        : {}),
      context_pack: this.withPinnedContextPack(bundle.context_pack, filteredSelectedContext)
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
    selectedContext: RagRetrievalChunkPayload[]
  ): RagContextPack | undefined {
    if (!contextPack) {
      return contextPack;
    }
    return {
      ...contextPack,
      selected_context_summary: {
        ...contextPack.selected_context_summary,
        count: selectedContext.length,
        snippets: selectedContext.map((chunk) => chunk.content.slice(0, 200))
      }
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
