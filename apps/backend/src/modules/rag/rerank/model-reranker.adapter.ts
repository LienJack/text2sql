import { Injectable } from "@nestjs/common";
import {
  ProviderRouterService,
  type RerankCandidateInput,
  type RerankCandidateResult,
  type RerankCandidatesResponse
} from "../../llm/provider-router.service";

export interface ModelRerankRequest {
  query: string;
  candidates: RerankCandidateInput[];
  modelCatalogId?: string;
}

export type ModelRerankResponse = RerankCandidatesResponse;

@Injectable()
export class ModelRerankerAdapter {
  constructor(private readonly providerRouter: ProviderRouterService) {}

  async rerank(input: ModelRerankRequest): Promise<RerankCandidateResult[]> {
    const response = await this.rerankWithMetadata(input);
    return response.results;
  }

  async rerankWithMetadata(input: ModelRerankRequest): Promise<ModelRerankResponse> {
    return this.providerRouter.rerankCandidatesWithMetadata({
      query: input.query,
      candidates: input.candidates,
      modelCatalogId: input.modelCatalogId
    });
  }
}
