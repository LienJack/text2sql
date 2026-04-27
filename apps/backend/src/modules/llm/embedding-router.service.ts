import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";
import { RagTaskConfigService } from "./rag-task-config.service";
import type {
  EmbeddingGateway,
  EmbeddingGatewayRequest,
  EmbeddingProviderMetadata,
  EmbeddingVectorPayload
} from "./embedding-gateway.interface";

interface OpenAiEmbeddingResponse {
  data?: Array<{
    embedding?: unknown;
  }>;
}

@Injectable()
export class EmbeddingRouterService implements EmbeddingGateway {
  constructor(
    private readonly config: AppConfigService,
    private readonly ragTaskConfigService: RagTaskConfigService
  ) {}

  async embed(input: EmbeddingGatewayRequest): Promise<EmbeddingVectorPayload[]> {
    const texts = input.texts
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (texts.length === 0) {
      return [];
    }

    const testScopedMockMode = this.config.llmMockMode && this.config.nodeEnv === "test";
    if (this.config.embeddingMockMode || testScopedMockMode) {
      return this.embedInMockMode(texts, input);
    }

    const runtime = await this.ragTaskConfigService.resolveEmbeddingRuntime();
    const baseUrl = runtime.baseUrl.trim();
    const apiKey = runtime.apiKey.trim();

    const endpoint = `${baseUrl.replace(/\/$/, "")}/embeddings`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: input.model ?? runtime.model,
        input: texts,
        ...(runtime.dimensions
          ? {
              dimensions: runtime.dimensions
            }
          : {})
      }),
      signal: AbortSignal.timeout(runtime.timeoutMs)
    }).catch((error: unknown) => {
      throw new DomainError(
        "EMBEDDING_PROVIDER_REQUEST_FAILED",
        `Embedding provider 请求失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
        502,
        {
          provider: runtime.provider,
          configSource: runtime.configSource
        }
      );
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      throw new DomainError(
        "EMBEDDING_PROVIDER_RESPONSE_ERROR",
        `Embedding provider 返回异常 (${response.status})。`,
        502,
        {
          provider: runtime.provider,
          configSource: runtime.configSource,
          statusCode: response.status,
          body: responseText.slice(0, 500)
        }
      );
    }

    const payload = (await response.json().catch(() => ({}))) as OpenAiEmbeddingResponse;
    const rows = Array.isArray(payload.data) ? payload.data : [];
    if (rows.length !== texts.length) {
      throw new DomainError(
        "EMBEDDING_PROVIDER_INVALID_PAYLOAD",
        "Embedding provider 返回向量数量与请求不一致。",
        502,
        {
          provider: runtime.provider,
          configSource: runtime.configSource,
          expected: texts.length,
          actual: rows.length
        }
      );
    }

    const vectors = rows.map((row) => this.toVector(row.embedding));
    const dimensions = vectors[0]?.length ?? 0;
    if (dimensions <= 0) {
      throw new DomainError(
        "EMBEDDING_PROVIDER_INVALID_VECTOR",
        "Embedding provider 未返回可用向量。",
        502,
        {
          provider: runtime.provider,
          configSource: runtime.configSource
        }
      );
    }

    const metadata: EmbeddingProviderMetadata = {
      provider: runtime.provider,
      model: input.model ?? runtime.model,
      dimensions,
      vectorVersion: runtime.vectorVersion ?? this.config.embeddingVectorVersion,
      configSource: runtime.configSource,
      configId: runtime.configId,
      indexVersion: input.indexVersion,
      scope: input.scope,
      assetType: input.assetType
    };

    return vectors.map((vector) => ({
      vector,
      metadata
    }));
  }

  private embedInMockMode(
    texts: string[],
    input: EmbeddingGatewayRequest
  ): EmbeddingVectorPayload[] {
    const dimensions = this.config.embeddingDimensions ?? 8;
    const metadata: EmbeddingProviderMetadata = {
      provider: `${this.config.embeddingProvider}:mock`,
      model: input.model ?? this.config.embeddingModel,
      dimensions,
      vectorVersion: this.config.embeddingVectorVersion,
      indexVersion: input.indexVersion,
      scope: input.scope,
      assetType: input.assetType
    };

    return texts.map((text) => ({
      vector: this.buildDeterministicVector(text, dimensions),
      metadata
    }));
  }

  private buildDeterministicVector(text: string, dimensions: number): number[] {
    const digest = createHash("sha256").update(text).digest();
    return Array.from({ length: dimensions }, (_, index) => {
      const byte = digest[index % digest.length] ?? 0;
      const normalized = byte / 255;
      return Number((normalized * 2 - 1).toFixed(6));
    });
  }

  private toVector(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
  }
}
