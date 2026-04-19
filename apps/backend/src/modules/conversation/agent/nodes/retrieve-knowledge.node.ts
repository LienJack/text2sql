import { Injectable } from "@nestjs/common";
import { RagRetrievalService } from "../../../knowledge/rag/retrieval/rag-retrieval.service";
import { RagRerankService } from "../../../knowledge/rag/rerank/rag-rerank.service";
import type { RagRetrievalBundle } from "../../../knowledge/rag/retrieval/rag-retrieval.types";

export interface RetrievedKnowledge {
  status: "ready" | "degraded";
  snippets: string[];
  summary: string;
  retrievalBundle?: RagRetrievalBundle;
}

@Injectable()
export class RetrieveKnowledgeNode {
  constructor(
    private readonly retrievalService: RagRetrievalService,
    private readonly rerankService: RagRerankService
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
          risk_tags: ["rag_zero_recall"]
        }
      };
    }

    const retrieved = await this.retrievalService.retrieve({
      query: normalized,
      datasourceId,
      runId
    });
    const reranked = await this.rerankService.rerank({
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
      retrievalBundle: bundle
    };
  }
}
