import type { LlmProviderCode } from "@text2sql/shared-types";

export interface ProviderRuntimeConfig {
  provider: LlmProviderCode;
  baseUrl?: string | null;
  apiKey?: string;
  timeoutMs: number;
}

export interface ProviderModelDescriptor {
  model: string;
  displayName: string;
  capabilities?: string[];
  contextWindow?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ProviderHealthResult {
  healthy: boolean;
  message: string;
  checkedAt: string;
  latencyMs: number;
}

export interface ProviderAdapter {
  readonly provider: LlmProviderCode;
  readonly supportsModelListing: boolean;
  resolveBaseUrl(config: ProviderRuntimeConfig): string;
  listModels(config: ProviderRuntimeConfig): Promise<ProviderModelDescriptor[]>;
  checkHealth(config: ProviderRuntimeConfig): Promise<ProviderHealthResult>;
}
