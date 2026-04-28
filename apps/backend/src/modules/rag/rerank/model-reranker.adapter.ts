import { Injectable } from "@nestjs/common";
import {
  type RerankCandidateInput,
  type RerankCandidateResult,
  type RerankCandidatesResponse
} from "../../llm/provider-router.service";
import { RerankRouterService } from "../../llm/rerank-router.service";

export interface ModelRerankRequest {
  query: string;
  candidates: RerankCandidateInput[];
  modelCatalogId?: string;
}

export type ModelRerankResponse = RerankCandidatesResponse;

@Injectable()
export class ModelRerankerAdapter {
  constructor(private readonly rerankRouter: RerankRouterService) {}

  async rerank(input: ModelRerankRequest): Promise<RerankCandidateResult[]> {
    const response = await this.rerankWithMetadata(input);
    return response.results;
  }

  async rerankWithMetadata(input: ModelRerankRequest): Promise<ModelRerankResponse> {
    return this.rerankRouter.rerankCandidatesWithMetadata({
      query: input.query,
      candidates: input.candidates
    });
  }
}
