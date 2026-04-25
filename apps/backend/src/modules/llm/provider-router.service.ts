import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { LlmGatewayService } from "./llm-gateway.service";
import type {
  LlmGatewayPrompt,
  LlmGatewayRuntimeConfig,
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "./llm-gateway.interface";
import { ProviderCatalogService } from "./provider-catalog.service";

export interface LlmDraft {
  provider: string;
  model: string;
  modelCatalogId?: string;
  rawText: string;
  prompt: LlmGatewayPrompt;
}

export interface RerankCandidateInput {
  candidateId: string;
  content: string;
  domain: string;
  sourceLane: string;
  evidence: string[];
  baseScore: number;
}

export interface RerankCandidateResult {
  candidateId: string;
  score: number;
  reason: string;
}

@Injectable()
export class ProviderRouterService {
  constructor(
    private readonly config: AppConfigService,
    private readonly providerCatalog: ProviderCatalogService,
    private readonly llmGateway: LlmGatewayService
  ) {}

  async generate(
    prompt: LlmGatewayPrompt,
    selection?: {
      modelCatalogId?: string;
    }
  ): Promise<LlmDraft> {
    const resolved = await this.resolveRuntime(selection?.modelCatalogId);
    const completion = await this.llmGateway.generate(prompt, resolved.runtime);
    return {
      provider: completion.provider,
      model: completion.model,
      modelCatalogId: resolved.modelCatalogId,
      rawText: completion.rawText,
      prompt
    };
  }

  async stream(
    prompt: LlmGatewayPrompt,
    selection?: {
      modelCatalogId?: string;
    },
    options?: {
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<LlmDraft> {
    const resolved = await this.resolveRuntime(selection?.modelCatalogId);
    const completion = await this.llmGateway.stream(prompt, resolved.runtime, options);
    return {
      provider: completion.provider,
      model: completion.model,
      modelCatalogId: resolved.modelCatalogId,
      rawText: completion.rawText,
      prompt
    };
  }

  async rerankCandidates(input: {
    query: string;
    candidates: RerankCandidateInput[];
    modelCatalogId?: string;
  }): Promise<RerankCandidateResult[]> {
    if (input.candidates.length === 0) {
      return [];
    }

    if (this.config.llmMockMode) {
      return this.rerankInMockMode(input.query, input.candidates);
    }

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

    const completion = await this.generate(prompt, {
      modelCatalogId: input.modelCatalogId
    });
    const parsed = this.parseRerankResponse(completion.rawText);
    if (parsed.length === 0) {
      return this.rerankInMockMode(input.query, input.candidates);
    }
    return parsed;
  }

  private async resolveRuntime(
    modelCatalogId?: string
  ): Promise<{
    modelCatalogId?: string;
    runtime: LlmGatewayRuntimeConfig;
  }> {
    if (modelCatalogId) {
      const resolved = await this.providerCatalog.resolveRuntimeByModelId(modelCatalogId);
      return {
        modelCatalogId: resolved.model.id,
        runtime: {
          provider: resolved.model.provider,
          model: resolved.model.model,
          baseUrl: resolved.runtime.baseUrl?.trim() || this.config.llmBaseUrl || "",
          apiKey: resolved.runtime.apiKey?.trim() || this.config.llmApiKey || "",
          timeoutMs: this.config.llmTimeoutMs,
          streamTimeoutMs: this.config.llmStreamTimeoutMs
        }
      };
    }

    try {
      const defaultModel = await this.providerCatalog.resolveDefaultModel();
      const defaultRuntime = await this.providerCatalog.resolveRuntimeConfig(
        defaultModel.providerConfigId
      );
      return {
        modelCatalogId: defaultModel.id,
        runtime: {
          provider: defaultModel.provider,
          model: defaultModel.model,
          baseUrl: defaultRuntime.baseUrl?.trim() || this.config.llmBaseUrl || "",
          apiKey: defaultRuntime.apiKey?.trim() || this.config.llmApiKey || "",
          timeoutMs: this.config.llmTimeoutMs,
          streamTimeoutMs: this.config.llmStreamTimeoutMs
        }
      };
    } catch {
      return {
        runtime: {
          provider: this.config.llmProvider,
          model: this.config.llmModel,
          baseUrl: this.config.llmBaseUrl,
          apiKey: this.config.llmApiKey,
          timeoutMs: this.config.llmTimeoutMs,
          streamTimeoutMs: this.config.llmStreamTimeoutMs
        }
      };
    }
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
