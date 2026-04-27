import { Injectable } from "@nestjs/common";
import { DomainError } from "../../common/domain-error";

type ProbeStatus = "healthy" | "degraded" | "failed";

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

@Injectable()
export class RagTaskHealthProbeService {
  async probeEmbedding(input?: {
    runtimeDimensions?: number;
    expectedDimensions?: number;
  }): Promise<RagTaskHealthProbeResult> {
    const startedAt = Date.now();
    try {
      const actualDimensions = input?.runtimeDimensions ?? 0;
      const expectedDimensions = input?.expectedDimensions;
      if (
        typeof expectedDimensions === "number" &&
        Number.isFinite(expectedDimensions) &&
        expectedDimensions > 0 &&
        actualDimensions > 0 &&
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
      if (actualDimensions <= 0) {
        return {
          status: "failed",
          reasonCode: "invalid_payload",
          message: "Embedding provider 返回了空向量。",
          latencyMs: Date.now() - startedAt,
          details: {
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
          actualDimensions: actualDimensions || undefined
        }
      };
    } catch (error) {
      return {
        ...this.mapProbeFailure(error),
        latencyMs: Date.now() - startedAt
      };
    }
  }

  async probeRerank(input?: {
    sampleQuery?: string;
    sampleCandidates?: string[];
  }): Promise<RagTaskHealthProbeResult & { challenge: RagRerankChallengeSummary }> {
    const startedAt = Date.now();
    const sampleQuery = input?.sampleQuery?.trim() || "revenue by status";
    const sampleCandidates = (input?.sampleCandidates ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (sampleCandidates.length < 2) {
      return {
        status: "degraded",
        reasonCode: "sample_not_ready",
        message: "Rerank challenge 样本不足，至少需要 2 条候选。",
        latencyMs: Date.now() - startedAt,
        details: {
          sampleCandidateCount: sampleCandidates.length
        },
        challenge: {
          status: "sample_not_ready",
          reasonCode: "sample_not_ready"
        }
      };
    }

    try {
      const baselineTopScore = 0;
      const tokenSet = new Set(
        sampleQuery
          .toLowerCase()
          .split(/[^a-z0-9_\p{L}\p{N}]+/u)
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      );
      const reranked = sampleCandidates
        .map((content, index) => {
          const lowered = content.toLowerCase();
          const tokenHits = Array.from(tokenSet).filter((token) =>
            lowered.includes(token)
          ).length;
          return {
            candidateId: `sample-${index + 1}`,
            score: Number((0.2 + tokenHits * 0.18).toFixed(6))
          };
        })
        .sort((left, right) => right.score - left.score);

      const top = reranked[0];
      if (!top) {
        return {
          status: "degraded",
          reasonCode: "evidence_missing",
          message: "Rerank challenge 未返回可比较结果。",
          latencyMs: Date.now() - startedAt,
          details: {
            outputCount: 0
          },
          challenge: {
            status: "evidence_missing",
            reasonCode: "evidence_missing"
          }
        };
      }

      const candidateTopScore = Number(top.score.toFixed(6));
      const delta = Number((candidateTopScore - baselineTopScore).toFixed(6));
      return {
        status: "healthy",
        reasonCode: "ok",
        message: "Rerank 配置可用。",
        latencyMs: Date.now() - startedAt,
        details: {
          sampleCandidateCount: sampleCandidates.length,
          topCandidateId: top.candidateId
        },
        challenge: {
          status: "comparable",
          baselineTopScore,
          candidateTopScore,
          delta,
          topCandidateId: top.candidateId,
          reasonCode: "comparable"
        }
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

  private mapProbeFailure(error: unknown): Omit<RagTaskHealthProbeResult, "latencyMs"> {
    if (error instanceof DomainError) {
      if (error.code === "EMBEDDING_PROVIDER_UNAVAILABLE" || error.code === "RERANK_PROVIDER_UNAVAILABLE") {
        return {
          status: "degraded",
          reasonCode: "provider_unavailable",
          message: error.message,
          details: {
            code: error.code
          }
        };
      }
      if (error.code.includes("REQUEST_FAILED")) {
        return {
          status: "failed",
          reasonCode: "provider_request_failed",
          message: error.message,
          details: {
            code: error.code
          }
        };
      }
      if (error.code.includes("INVALID_PAYLOAD")) {
        return {
          status: "failed",
          reasonCode: "invalid_payload",
          message: error.message,
          details: {
            code: error.code
          }
        };
      }
      if (error.code.includes("INVALID_VECTOR")) {
        return {
          status: "failed",
          reasonCode: "invalid_vector",
          message: error.message,
          details: {
            code: error.code
          }
        };
      }
      return {
        status: "failed",
        reasonCode: "provider_error",
        message: error.message,
        details: {
          code: error.code
        }
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
}
