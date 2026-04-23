import { Inject, Injectable } from "@nestjs/common";
import {
  KNOWLEDGE_RAG_CONTRACT,
  type KnowledgeRagContract
} from "../../../knowledge/contracts/knowledge-rag.contract";
import type {
  RagContextPack,
  RagRetrievalBundle
} from "../../../knowledge/rag/retrieval/rag-retrieval.types";

export interface RetrievedKnowledge {
  status: "ready" | "degraded";
  snippets: string[];
  summary: string;
  retrievalBundle?: RagRetrievalBundle;
  contextPack?: RagContextPack;
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
    modelCatalogId?: string;
  }): Promise<RetrievedKnowledge> {
    const question = input.question.trim();
    const datasourceId = input.datasourceId.trim();
    const runId = input.runId.trim();

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
        }
      };
    }

    const retrieved = await this.ragContract.retrieval.retrieve({
      query: normalized,
      datasourceId,
      runId
    });
    const reranked = await this.ragContract.rerank.rerank({
      retrievalBundle: retrieved.retrieval_bundle,
      modelCatalogId: input.modelCatalogId
    });
    const bundle = reranked.retrieval_bundle;
    const snippets = (bundle.selected_context ?? bundle.candidates.map((item) => item.chunk))
      .slice(0, 3)
      .map((item) => item.content.slice(0, 200));

    return {
      status: bundle.status,
      snippets,
      summary:
        bundle.status === "ready"
          ? `检索与重排完成，候选=${bundle.candidates.length}，上下文=${bundle.selected_context?.length ?? 0}。`
          : `检索链路降级执行，原因=${bundle.degrade_reasons.join(", ") || "unknown"}。`,
      retrievalBundle: bundle,
      contextPack: bundle.context_pack
    };
  }
}
