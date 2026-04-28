import { Injectable } from "@nestjs/common";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";

type ProbeStatus = "healthy" | "degraded" | "failed";

interface RagProbeRuntime {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  dimensions?: number;
  configSource?: string;
}

interface RerankProbeEntry {
  rank: number;
  score: number;
  reason: string;
}

export interface RagTaskHealthProbeResult {
  status: ProbeStatus;
  reasonCode: string;
  message: string;
  latencyMs: number;
  details?: Record<string, unknown>;
}

export interface RagRerankChallengeSummary {
  status: "comparable" | "sample_not_ready" | "evidence_missing" | "not_comparable";
  baselineTopScore?: number;
  candidateTopScore?: number;
  delta?: number;
  topCandidateId?: string;
  reasonCode: string;
}

export interface RagTaskRerankHealthProbeResult extends RagTaskHealthProbeResult {
  challenge: RagRerankChallengeSummary;
  reranked?: RerankProbeEntry[];
}

@Injectable()
export class RagTaskHealthProbeService {
  private static readonly BUILTIN_RERANK_SAMPLES = [
    "orders amount by status",
    "customer retention by month",
    "finance revenue cube summary"
  ];

  constructor(private readonly appConfig: AppConfigService) {}

  async probeEmbedding(input: {
    runtime: RagProbeRuntime;
    expectedDimensions?: number;
    sampleText?: string;
  }): Promise<RagTaskHealthProbeResult> {
    const startedAt = Date.now();
    if (this.shouldMockEmbedding()) {
      return this.probeEmbeddingInMockMode(input, startedAt);
    }

    try {
      const endpoint = this.joinEndpoint(input.runtime.baseUrl, "/embeddings");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.runtime.apiKey}`
        },
        body: JSON.stringify({
          model: input.runtime.model,
          input: [input.sampleText?.trim() || "health-check-ping"],
          ...(input.runtime.dimensions
            ? {
                dimensions: input.runtime.dimensions
              }
            : {})
        }),
        signal: AbortSignal.timeout(input.runtime.timeoutMs)
      });

      if (!response.ok) {
        return {
          ...this.mapHttpStatusFailure(
            response.status,
            "embedding",
            await this.safeReadBody(response)
          ),
          latencyMs: Date.now() - startedAt
        };
      }

      const payload = await response.json().catch(() => ({}));
      const vectors = this.readEmbeddingVectors(payload);
      const vector = vectors[0];
      if (!vector || vector.length === 0) {
        return {
          status: "failed",
          reasonCode: "schema_invalid",
          message: "Embedding provider 响应未返回可用向量。",
          latencyMs: Date.now() - startedAt,
          details: {
            outputCount: vectors.length
          }
        };
      }

      const actualDimensions = vector.length;
      const expectedDimensions = input.expectedDimensions;
      if (
        typeof expectedDimensions === "number" &&
        Number.isFinite(expectedDimensions) &&
        expectedDimensions > 0 &&
        actualDimensions !== expectedDimensions
      ) {
        return {
          status: "failed",
          reasonCode: "dimension_mismatch",
          message: `Embedding 维度不匹配（expected=${expectedDimensions}, actual=${actualDimensions}）。`,
          latencyMs: Date.now() - startedAt,
          details: {
            expectedDimensions,
            actualDimensions
          }
        };
      }
      if (
        typeof input.runtime.dimensions === "number" &&
        input.runtime.dimensions > 0 &&
        actualDimensions !== input.runtime.dimensions
      ) {
        return {
          status: "failed",
          reasonCode: "dimension_mismatch",
          message: `Embedding 返回维度与 runtime 配置不一致（expected=${input.runtime.dimensions}, actual=${actualDimensions}）。`,
          latencyMs: Date.now() - startedAt,
          details: {
            expectedDimensions: input.runtime.dimensions,
            actualDimensions
          }
        };
      }

      return {
        status: "healthy",
        reasonCode: "ok",
        message: "Embedding 配置可用。",
        latencyMs: Date.now() - startedAt,
        details: {
          actualDimensions,
          outputCount: vectors.length,
          provider: input.runtime.provider,
          model: input.runtime.model
        }
      };
    } catch (error) {
      return {
        ...this.mapProbeFailure(error),
        latencyMs: Date.now() - startedAt
      };
    }
  }

  async probeRerank(input: {
    runtime: RagProbeRuntime;
    sampleQuery?: string;
    sampleCandidates?: string[];
  }): Promise<RagTaskRerankHealthProbeResult> {
    const startedAt = Date.now();
    const sampleQuery = input.sampleQuery?.trim() || "revenue by status";
    const sampleCandidates = this.resolveRerankSamples(input.sampleCandidates);
    if (this.shouldMockRerank()) {
      return this.probeRerankInMockMode({
        sampleQuery,
        sampleCandidates,
        startedAt
      });
    }

    try {
      const endpoint = this.resolveRerankEndpoint(input.runtime);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.runtime.apiKey}`
        },
        body: JSON.stringify({
          model: input.runtime.model,
          query: sampleQuery,
          documents: sampleCandidates,
          top_n: sampleCandidates.length,
          return_documents: false
        }),
        signal: AbortSignal.timeout(input.runtime.timeoutMs)
      });

      if (!response.ok) {
        const failure = this.mapHttpStatusFailure(
          response.status,
          "rerank",
          await this.safeReadBody(response)
        );
        return {
          ...failure,
          latencyMs: Date.now() - startedAt,
          challenge: {
            status: "not_comparable",
            reasonCode: failure.reasonCode
          }
        };
      }

      const payload = await response.json().catch(() => ({}));
      const reranked = this.readRerankEntries(payload, sampleCandidates.length);
      if (reranked.length === 0) {
        return {
          status: "failed",
          reasonCode: "schema_invalid",
          message: "Rerank provider 响应无法解析有效排序。",
          latencyMs: Date.now() - startedAt,
          details: {
            outputCount: 0
          },
          challenge: {
            status: "evidence_missing",
            reasonCode: "schema_invalid"
          }
        };
      }

      const top = reranked[0];
      if (!top) {
        return {
          status: "failed",
          reasonCode: "evidence_missing",
          message: "Rerank provider 未返回可比较结果。",
          latencyMs: Date.now() - startedAt,
          challenge: {
            status: "evidence_missing",
            reasonCode: "evidence_missing"
          }
        };
      }

      const baselineTopScore = 0;
      const candidateTopScore = Number(top.score.toFixed(6));
      const delta = Number((candidateTopScore - baselineTopScore).toFixed(6));
      return {
        status: "healthy",
        reasonCode: "ok",
        message: "Rerank 配置可用。",
        latencyMs: Date.now() - startedAt,
        details: {
          sampleCandidateCount: sampleCandidates.length,
          outputCount: reranked.length,
          topCandidateId: `sample-${top.rank}`
        },
        challenge: {
          status: "comparable",
          baselineTopScore,
          candidateTopScore,
          delta,
          topCandidateId: `sample-${top.rank}`,
          reasonCode: "comparable"
        },
        reranked
      };
    } catch (error) {
      const mapped = this.mapProbeFailure(error);
      return {
        ...mapped,
        latencyMs: Date.now() - startedAt,
        challenge: {
          status: "not_comparable",
          reasonCode: mapped.reasonCode
        }
      };
    }
  }

  private probeEmbeddingInMockMode(
    input: {
      runtime: RagProbeRuntime;
      expectedDimensions?: number;
    },
    startedAt: number
  ): RagTaskHealthProbeResult {
    const actualDimensions = input.runtime.dimensions ?? this.appConfig.embeddingDimensions ?? 8;
    if (
      typeof input.expectedDimensions === "number" &&
      Number.isFinite(input.expectedDimensions) &&
      input.expectedDimensions > 0 &&
      input.expectedDimensions !== actualDimensions
    ) {
      return {
        status: "failed",
        reasonCode: "dimension_mismatch",
        message: `Embedding 维度不匹配（expected=${input.expectedDimensions}, actual=${actualDimensions}）。`,
        latencyMs: Date.now() - startedAt,
        details: {
          expectedDimensions: input.expectedDimensions,
          actualDimensions
        }
      };
    }

    return {
      status: "healthy",
      reasonCode: "ok",
      message: "Embedding 配置可用（mock）。",
      latencyMs: Date.now() - startedAt,
      details: {
        actualDimensions,
        mockMode: true
      }
    };
  }

  private probeRerankInMockMode(input: {
    sampleQuery: string;
    sampleCandidates: string[];
    startedAt: number;
  }): RagTaskRerankHealthProbeResult {
    const reranked = this.buildTokenScoredRerank(input.sampleQuery, input.sampleCandidates);
    const top = reranked[0];
    if (!top) {
      return {
        status: "failed",
        reasonCode: "evidence_missing",
        message: "Rerank challenge 未返回可比较结果。",
        latencyMs: Date.now() - input.startedAt,
        challenge: {
          status: "evidence_missing",
          reasonCode: "evidence_missing"
        }
      };
    }

    const candidateTopScore = Number(top.score.toFixed(6));
    return {
      status: "healthy",
      reasonCode: "ok",
      message: "Rerank 配置可用（mock）。",
      latencyMs: Date.now() - input.startedAt,
      details: {
        sampleCandidateCount: input.sampleCandidates.length,
        outputCount: reranked.length,
        mockMode: true
      },
      challenge: {
        status: "comparable",
        baselineTopScore: 0,
        candidateTopScore,
        delta: candidateTopScore,
        topCandidateId: `sample-${top.rank}`,
        reasonCode: "comparable"
      },
      reranked
    };
  }

  private shouldMockEmbedding(): boolean {
    return (
      this.appConfig.embeddingMockMode ||
      (this.appConfig.llmMockMode && this.appConfig.nodeEnv === "test")
    );
  }

  private shouldMockRerank(): boolean {
    return (
      this.appConfig.rerankMockMode ||
      (this.appConfig.llmMockMode && this.appConfig.nodeEnv === "test")
    );
  }

  private resolveRerankSamples(sampleCandidates?: string[]): string[] {
    const normalized = (sampleCandidates ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 10);
    if (normalized.length >= 2) {
      return normalized;
    }
    const merged = [...normalized];
    for (const candidate of RagTaskHealthProbeService.BUILTIN_RERANK_SAMPLES) {
      if (merged.length >= 3) {
        break;
      }
      if (!merged.includes(candidate)) {
        merged.push(candidate);
      }
    }
    return merged;
  }

  private buildTokenScoredRerank(query: string, candidates: string[]): RerankProbeEntry[] {
    const tokens = new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_\p{L}\p{N}]+/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    );
    return candidates
      .map((candidate) => {
        const lowered = candidate.toLowerCase();
        const tokenHits = Array.from(tokens).filter((token) =>
          lowered.includes(token)
        ).length;
        const score = Number((0.2 + tokenHits * 0.18).toFixed(6));
        return {
          score: Math.max(0, Math.min(1, score)),
          reason: `token_match=${tokenHits}`
        };
      })
      .sort((left, right) => right.score - left.score)
      .map((item, index) => ({
        rank: index + 1,
        score: item.score,
        reason: item.reason
      }));
  }

  private readEmbeddingVectors(payload: unknown): number[][] {
    if (!this.isRecord(payload)) {
      return [];
    }
    const rows = Array.isArray(payload.data) ? payload.data : [];
    return rows
      .map((row) => this.toVector(this.isRecord(row) ? row.embedding : undefined))
      .filter((row) => row.length > 0);
  }

  private readRerankEntries(payload: unknown, maxCount: number): RerankProbeEntry[] {
    if (!this.isRecord(payload)) {
      return [];
    }
    const rows = Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload.data)
        ? payload.data
        : [];
    const parsed = rows
      .map((row) => this.toRerankEntry(row))
      .filter((entry): entry is RerankProbeEntry => Boolean(entry))
      .slice(0, Math.max(1, maxCount));
    return parsed.length > 0
      ? parsed
          .sort((left, right) => right.score - left.score)
          .map((entry, index) => ({
            ...entry,
            rank: index + 1
          }))
      : [];
  }

  private toRerankEntry(value: unknown): RerankProbeEntry | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const score = this.readScore(value);
    if (!Number.isFinite(score)) {
      return undefined;
    }
    const reasonRaw = value.reason;
    const reason =
      typeof reasonRaw === "string" && reasonRaw.trim().length > 0
        ? reasonRaw.trim()
        : "provider_rerank";
    return {
      rank: 0,
      score: Math.max(0, Math.min(1, score)),
      reason
    };
  }

  private readScore(value: Record<string, unknown>): number {
    if (typeof value.score === "number" && Number.isFinite(value.score)) {
      return value.score;
    }
    if (
      typeof value.relevance_score === "number" &&
      Number.isFinite(value.relevance_score)
    ) {
      return value.relevance_score;
    }
    return Number.NaN;
  }

  private toVector(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
  }

  private resolveRerankEndpoint(runtime: RagProbeRuntime): string {
    if (runtime.provider === "tongyi" && !runtime.baseUrl.includes("/compatible-mode/")) {
      return this.joinEndpoint(runtime.baseUrl, "/services/rerank/text-rerank/text-rerank");
    }
    return this.joinEndpoint(runtime.baseUrl, "/rerank");
  }

  private joinEndpoint(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  private async safeReadBody(response: Response): Promise<string> {
    const raw = await response.text().catch(() => "");
    return raw.slice(0, 500);
  }

  private mapHttpStatusFailure(
    statusCode: number,
    operation: "embedding" | "rerank",
    bodySnippet: string
  ): Omit<RagTaskHealthProbeResult, "latencyMs"> {
    if (statusCode === 401 || statusCode === 403) {
      return {
        status: "failed",
        reasonCode: "auth_failed",
        message: `${operation} provider 鉴权失败（${statusCode}）。`,
        details: {
          statusCode,
          body: bodySnippet
        }
      };
    }
    if (statusCode === 404) {
      return {
        status: "failed",
        reasonCode: "model_not_found",
        message: `${operation} provider 模型或端点不存在（404）。`,
        details: {
          statusCode,
          body: bodySnippet
        }
      };
    }
    if (statusCode >= 500) {
      return {
        status: "degraded",
        reasonCode: "provider_5xx",
        message: `${operation} provider 服务异常（${statusCode}）。`,
        details: {
          statusCode,
          body: bodySnippet
        }
      };
    }
    return {
      status: "failed",
      reasonCode: "schema_invalid",
      message: `${operation} provider 返回不可用响应（${statusCode}）。`,
      details: {
        statusCode,
        body: bodySnippet
      }
    };
  }

  private mapProbeFailure(error: unknown): Omit<RagTaskHealthProbeResult, "latencyMs"> {
    if (error instanceof DomainError) {
      if (
        error.code === "EMBEDDING_PROVIDER_UNAVAILABLE" ||
        error.code === "RERANK_PROVIDER_UNAVAILABLE"
      ) {
        return {
          status: "degraded",
          reasonCode: "provider_unavailable",
          message: error.message,
          details: {
            code: error.code
          }
        };
      }
      if (error.code.includes("TIMEOUT")) {
        return {
          status: "degraded",
          reasonCode: "timeout",
          message: error.message,
          details: {
            code: error.code
          }
        };
      }
      if (error.code.includes("AUTH")) {
        return {
          status: "failed",
          reasonCode: "auth_failed",
          message: error.message,
          details: {
            code: error.code
          }
        };
      }
      return {
        status: "failed",
        reasonCode: "unexpected_error",
        message: error.message,
        details: {
          code: error.code
        }
      };
    }

    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return {
        status: "degraded",
        reasonCode: "timeout",
        message: `RAG 健康检查超时: ${error.message}`
      };
    }

    if (error instanceof TypeError) {
      return {
        status: "degraded",
        reasonCode: "endpoint_unreachable",
        message: `RAG 健康检查网络不可达: ${error.message}`
      };
    }

    if (error instanceof Error) {
      return {
        status: "failed",
        reasonCode: "unexpected_error",
        message: error.message
      };
    }

    return {
      status: "failed",
      reasonCode: "unexpected_error",
      message: "RAG 健康检查失败。"
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
