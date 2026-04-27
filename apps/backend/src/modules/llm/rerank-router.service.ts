import { Injectable } from "@nestjs/common";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";
import { LlmGatewayService } from "./llm-gateway.service";
import type { LlmGatewayPrompt } from "./llm-gateway.interface";
import {
  type RerankCandidateInput,
  type RerankCandidateResult,
  type RerankCandidatesResponse
} from "./provider-router.service";
import { RagTaskConfigService } from "./rag-task-config.service";

@Injectable()
export class RerankRouterService {
  constructor(
    private readonly config: AppConfigService,
    private readonly llmGateway: LlmGatewayService,
    private readonly ragTaskConfigService: RagTaskConfigService
  ) {}

  async rerankCandidates(input: {
    query: string;
    candidates: RerankCandidateInput[];
  }): Promise<RerankCandidateResult[]> {
    const response = await this.rerankCandidatesWithMetadata(input);
    return response.results;
  }

  async rerankCandidatesWithMetadata(input: {
    query: string;
    candidates: RerankCandidateInput[];
  }): Promise<RerankCandidatesResponse> {
    if (input.candidates.length === 0) {
      return {
        results: [],
        metadata: {
          mode: this.config.rerankMockMode ? "mock" : "provider",
          provider: this.config.rerankProvider,
          model: this.config.rerankModel,
          configSource: "missing",
          inputCount: 0,
          outputCount: 0
        }
      };
    }

    const testScopedMockMode = this.config.llmMockMode && this.config.nodeEnv === "test";
    if (this.config.rerankMockMode || testScopedMockMode) {
      const results = this.rerankInMockMode(input.query, input.candidates);
      return {
        results,
        metadata: {
          mode: "mock",
          provider: `${this.config.rerankProvider}:mock`,
          model: this.config.rerankModel,
          configSource: "env_fallback",
          inputCount: input.candidates.length,
          outputCount: results.length,
          fallbackReason: this.config.rerankMockMode
            ? "rerank_mock_mode"
            : "llm_mock_mode"
        }
      };
    }

    const runtime = await this.ragTaskConfigService.resolveRerankRuntime();
    const prompt: LlmGatewayPrompt = {
      systemPrompt:
        "You are a retrieval reranker. Return strict JSON only.",
      userPrompt: JSON.stringify(
        {
          task: "rerank_candidates",
          query: input.query,
          outputSchema: {
            reranked: [
              {
                candidateId: "string",
                score: "number between 0 and 1",
                reason: "short reason"
              }
            ]
          },
          candidates: input.candidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            domain: candidate.domain,
            sourceLane: candidate.sourceLane,
            baseScore: candidate.baseScore,
            evidence: candidate.evidence.slice(0, 3),
            contentPreview: candidate.content.slice(0, 400)
          }))
        },
        null,
        2
      )
    };

    const completion = await this.llmGateway.generate(prompt, {
      provider: runtime.provider,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      timeoutMs: runtime.timeoutMs
    });
    const parsed = this.parseRerankResponse(completion.rawText);
    if (parsed.length === 0) {
      throw new DomainError(
        "RERANK_PROVIDER_INVALID_PAYLOAD",
        "Rerank provider 未返回有效排序结果。",
        502,
        {
          provider: completion.provider,
          model: completion.model,
          configSource: runtime.configSource,
          inputCount: input.candidates.length
        }
      );
    }
    return {
      results: parsed,
      metadata: {
        mode: "provider",
        provider: completion.provider,
        model: completion.model,
        configSource: runtime.configSource,
        configId: runtime.configId,
        inputCount: input.candidates.length,
        outputCount: parsed.length
      }
    };
  }

  private rerankInMockMode(
    query: string,
    candidates: RerankCandidateInput[]
  ): RerankCandidateResult[] {
    const tokens = this.extractTokens(query);
    return candidates.map((candidate) => {
      const content = candidate.content.toLowerCase();
      const tokenMatch = tokens.filter((token) => content.includes(token)).length;
      const domainBoost =
        candidate.domain === "semantic_term"
          ? 0.12
          : candidate.domain === "schema"
            ? 0.08
            : 0.05;
      const score = Math.max(
        0,
        Math.min(1, Number((candidate.baseScore * 0.6 + tokenMatch * 0.12 + domainBoost).toFixed(6)))
      );
      return {
        candidateId: candidate.candidateId,
        score,
        reason: `mock rerank tokenMatch=${tokenMatch} domain=${candidate.domain}`
      };
    });
  }

  private parseRerankResponse(rawText: string): RerankCandidateResult[] {
    const normalized = rawText.trim();
    if (!normalized) {
      return [];
    }
    const jsonCandidate = this.extractJsonBlock(normalized);
    if (!jsonCandidate) {
      return [];
    }
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      const rows = Array.isArray(parsed)
        ? parsed
        : this.isRecord(parsed) && Array.isArray(parsed.reranked)
          ? parsed.reranked
          : [];
      return rows
        .map((row) => this.toRerankResult(row))
        .filter((row): row is RerankCandidateResult => Boolean(row));
    } catch {
      return [];
    }
  }

  private toRerankResult(row: unknown): RerankCandidateResult | undefined {
    if (!this.isRecord(row)) {
      return undefined;
    }
    const candidateId =
      typeof row.candidateId === "string" ? row.candidateId.trim() : "";
    const score = Number(row.score);
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    if (!candidateId || !Number.isFinite(score)) {
      return undefined;
    }
    return {
      candidateId,
      score: Math.max(0, Math.min(1, score)),
      reason: reason || "model_rerank"
    };
  }

  private extractJsonBlock(text: string): string | undefined {
    const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }
    if (text.startsWith("{") || text.startsWith("[")) {
      return text;
    }
    const firstBrace = text.indexOf("{");
    const firstBracket = text.indexOf("[");
    const startIndexCandidates = [firstBrace, firstBracket].filter(
      (index) => index >= 0
    );
    if (startIndexCandidates.length === 0) {
      return undefined;
    }
    const startIndex = Math.min(...startIndexCandidates);
    return text.slice(startIndex).trim();
  }

  private extractTokens(value: string): string[] {
    const tokens = value
      .toLowerCase()
      .match(/[a-z0-9_\p{L}\p{N}]+/gu);
    if (!tokens) {
      return [];
    }
    return Array.from(new Set(tokens.filter((token) => token.trim().length > 0)));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
