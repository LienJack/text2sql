import { Injectable } from "@nestjs/common";
import type { Text2SqlV2StageName } from "@text2sql/shared-types";
import { DomainError } from "../../common/domain-error";
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

export interface RerankExecutionMetadata {
  mode: "provider" | "mock";
  provider?: string;
  model?: string;
  configSource?: "settings" | "env_fallback" | "missing";
  configId?: string;
  inputCount: number;
  outputCount: number;
  fallbackReason?: string;
  unavailableReason?: string;
}

export interface RerankCandidatesResponse {
  results: RerankCandidateResult[];
  metadata: RerankExecutionMetadata;
}

export type Text2SqlReasoningTier = "low" | "medium" | "high";

export interface Text2SqlStageTaskProfilePolicy {
  stage: Text2SqlV2StageName;
  taskProfile: string;
  reasoningTier: Text2SqlReasoningTier;
  provider: string;
  model: string;
  policySource:
    | "session_model_catalog_binding"
    | "session_model_binding"
    | "router_default_binding";
  escalationReason?: string;
}

interface StageTaskProfileRule {
  taskProfile: string;
  reasoningTier: Text2SqlReasoningTier;
}

const DEFAULT_TEXT2SQL_STAGE_POLICY_MATRIX: Record<
  Text2SqlV2StageName,
  StageTaskProfileRule
> = {
  intake: {
    taskProfile: "intake-fast",
    reasoningTier: "low"
  },
  retrieve: {
    taskProfile: "retrieval-support",
    reasoningTier: "low"
  },
  "assemble-context": {
    taskProfile: "context-assembly",
    reasoningTier: "low"
  },
  "semantic-plan": {
    taskProfile: "semantic-planning",
    reasoningTier: "high"
  },
  "generate-sql": {
    taskProfile: "sql-generation",
    reasoningTier: "high"
  },
  validate: {
    taskProfile: "sql-validation",
    reasoningTier: "medium"
  },
  correct: {
    taskProfile: "sql-correction",
    reasoningTier: "medium"
  },
  execute: {
    taskProfile: "sql-execution",
    reasoningTier: "low"
  },
  answer: {
    taskProfile: "answer-rendering",
    reasoningTier: "low"
  }
};

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
    const response = await this.rerankCandidatesWithMetadata(input);
    return response.results;
  }

  async rerankCandidatesWithMetadata(input: {
    query: string;
    candidates: RerankCandidateInput[];
    modelCatalogId?: string;
  }): Promise<RerankCandidatesResponse> {
    if (input.candidates.length === 0) {
      return {
        results: [],
        metadata: {
          mode: this.config.llmMockMode ? "mock" : "provider",
          provider: this.config.llmProvider,
          model: this.config.llmModel,
          inputCount: 0,
          outputCount: 0
        }
      };
    }

    if (this.config.llmMockMode) {
      const results = this.rerankInMockMode(input.query, input.candidates);
      return {
        results,
        metadata: {
          mode: "mock",
          provider: `${this.config.llmProvider}:mock`,
          model: this.config.llmModel,
          inputCount: input.candidates.length,
          outputCount: results.length,
          fallbackReason: "llm_mock_mode"
        }
      };
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
      throw new DomainError(
        "RERANK_PROVIDER_INVALID_PAYLOAD",
        "Rerank provider 未返回有效排序结果。",
        502,
        {
          provider: completion.provider,
          model: completion.model,
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
        inputCount: input.candidates.length,
        outputCount: parsed.length
      }
    };
  }

  resolveText2SqlStageTaskProfilePolicy(input: {
    stage: Text2SqlV2StageName;
    modelCatalogId?: string;
    provider?: string;
    model?: string;
    escalationReason?: string;
  }): Text2SqlStageTaskProfilePolicy {
    const stageRule = DEFAULT_TEXT2SQL_STAGE_POLICY_MATRIX[input.stage];
    const provider = this.normalizeProviderModel(input.provider, this.config.llmProvider);
    const model = this.normalizeProviderModel(input.model, this.config.llmModel);
    const policySource = input.modelCatalogId
      ? "session_model_catalog_binding"
      : input.provider || input.model
        ? "session_model_binding"
        : "router_default_binding";

    return {
      stage: input.stage,
      taskProfile: stageRule.taskProfile,
      reasoningTier: this.resolveReasoningTier(stageRule.reasoningTier, input.escalationReason),
      provider,
      model,
      policySource,
      ...(input.escalationReason
        ? {
            escalationReason: input.escalationReason
          }
        : {})
    };
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

  private normalizeProviderModel(
    value: string | undefined,
    fallback: string | undefined
  ): string {
    const normalized = value?.trim() || fallback?.trim();
    return normalized && normalized.length > 0 ? normalized : "unknown";
  }

  private resolveReasoningTier(
    baseline: Text2SqlReasoningTier,
    escalationReason?: string
  ): Text2SqlReasoningTier {
    if (!escalationReason) {
      return baseline;
    }
    if (baseline === "high") {
      return "high";
    }
    if (baseline === "medium") {
      return "high";
    }
    return "medium";
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
