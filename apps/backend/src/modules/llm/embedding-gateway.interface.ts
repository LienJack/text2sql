export interface EmbeddingProviderMetadata {
  provider: string;
  model: string;
  dimensions: number;
  vectorVersion: string;
  configSource?: "settings" | "env_fallback" | "missing";
  configId?: string;
  indexVersion?: string;
  scope?: string;
  assetType?: string;
}

export interface EmbeddingVectorPayload {
  vector: number[];
  metadata: EmbeddingProviderMetadata;
}

export interface EmbeddingGatewayRequest {
  texts: string[];
  model?: string;
  indexVersion?: string;
  scope?: string;
  assetType?: string;
}

export interface EmbeddingGateway {
  embed(input: EmbeddingGatewayRequest): Promise<EmbeddingVectorPayload[]>;
}
