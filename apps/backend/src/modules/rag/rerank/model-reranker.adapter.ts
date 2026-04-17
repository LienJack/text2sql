import { Injectable } from "@nestjs/common";
import {
  ProviderRouterService,
  type RerankCandidateInput,
  type RerankCandidateResult
} from "../../llm/provider-router.service";

export interface ModelRerankRequest {
  query: string;
  candidates: RerankCandidateInput[];
  modelCatalogId?: string;
}

@Injectable()
export class ModelRerankerAdapter {
  constructor(private readonly providerRouter: ProviderRouterService) {}

  async rerank(input: ModelRerankRequest): Promise<RerankCandidateResult[]> {
    return this.providerRouter.rerankCandidates({
      query: input.query,
      candidates: input.candidates,
      modelCatalogId: input.modelCatalogId
    });
  }
}
