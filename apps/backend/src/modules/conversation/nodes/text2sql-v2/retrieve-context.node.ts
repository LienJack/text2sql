import { Injectable } from "@nestjs/common";
import {
  type RetrievedKnowledge,
  type RetrievedKnowledgeTypedSummary,
  RetrieveKnowledgeNode
} from "../../agent/nodes/retrieve-knowledge.node";

export interface RetrieveContextNodeInput {
  question: string;
  datasourceId: string;
  runId: string;
  workspaceId?: string;
  allowedTables?: string[];
  modelCatalogId?: string;
  pinnedTables?: string[];
  pinnedColumns?: string[];
}

export interface RetrieveContextNodeState {
  status: "ready" | "degraded";
  typedSummary: RetrievedKnowledgeTypedSummary;
  evidenceRefs: string[];
  retrievalBundleRef?: {
    runId: string;
    datasourceId: string;
    indexVersionId?: string;
    status: "ready" | "degraded";
    degradeReasons: string[];
  };
  selectedContextSummary: {
    count: number;
    snippetPreviews: string[];
  };
  warnings: string[];
}

export interface RetrieveContextNodeOutput {
  state: RetrieveContextNodeState;
  artifact: RetrievedKnowledge;
}

@Injectable()
export class RetrieveContextNode {
  constructor(private readonly retrieveKnowledgeNode: RetrieveKnowledgeNode) {}

  async run(input: RetrieveContextNodeInput): Promise<RetrieveContextNodeOutput> {
    const artifact = await this.retrieveKnowledgeNode.run(input);
    const bundle = artifact.retrievalBundle;
    const typedSummary = artifact.typedSummary;
    const warnings = this.unique([
      ...(artifact.contextPack?.degrade_reasons ?? artifact.contextPack?.degradeReasons ?? []),
      ...(typedSummary.denseReason
        ? [`dense_${typedSummary.denseState}:${typedSummary.denseReason}`]
        : []),
      ...(typedSummary.rerankReason
        ? [`rerank_${typedSummary.rerankState}:${typedSummary.rerankReason}`]
        : []),
      ...typedSummary.degradeReasons
    ]);

    return {
      state: {
        status: artifact.status,
        typedSummary,
        evidenceRefs: artifact.evidenceRefs.slice(0, 128),
        retrievalBundleRef: bundle
          ? {
              runId: bundle.run_id,
              datasourceId: bundle.datasource_id,
              indexVersionId: bundle.index_version_id,
              status: bundle.status,
              degradeReasons: bundle.degrade_reasons ?? []
            }
          : undefined,
        selectedContextSummary: {
          count: bundle?.selected_context?.length ?? 0,
          snippetPreviews: (bundle?.selected_context ?? [])
            .map((chunk) => chunk.content.slice(0, 160))
            .slice(0, 5)
        },
        warnings
      },
      artifact
    };
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
  }
}
