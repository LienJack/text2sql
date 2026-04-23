import { Injectable } from "@nestjs/common";
import type { DatasourceType, PromptTemplateTraceEvidence } from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import type {
  LlmGatewayPrompt,
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../../llm/llm-gateway.interface";
import type { LlmDraft } from "../../../llm/provider-router.service";
import { ProviderRouterService } from "../../../llm/provider-router.service";
import { SqlOutputExtractor } from "./sql-output-extractor";
import {
  SqlPromptBuilder,
  type SqlSemanticIntent
} from "./sql-prompt.builder";
import { PromptTemplateService } from "../../../governance/settings/prompt-template.service";
import type { RetrievedKnowledge } from "../nodes/retrieve-knowledge.node";
import type { RagContextPack } from "../../../rag/retrieval/rag-retrieval.types";

type RagRetrievalChunkPayload = NonNullable<
  NonNullable<RetrievedKnowledge["retrievalBundle"]>["selected_context"]
>[number];

interface SqlGenerationSelection {
  datasourceId?: string;
  workspaceId?: string;
  datasourceType?: DatasourceType;
  modelCatalogId?: string;
  selectedContext?: RagRetrievalChunkPayload[];
  semanticContextPack?: RagContextPack;
  semanticIntent?: SqlSemanticIntent;
}

const MAX_SEMANTIC_REPAIR_RETRY = 1;
const COUNT_INTENT_REGEX =
  /(多少|几条|几笔|总数|数量|计数|count|人数|单量|订单量|客户数|用户数)/i;
const METADATA_INTENT_REGEX =
  /(有哪些表|哪些表|多少张表|多少个表|表结构|schema|字段|列名|describe|desc\s+\w+|show\s+tables|sqlite_master|sqlite_schema|information_schema|pg_catalog|pragma|元数据|数据库结构)/i;
const COUNT_SQL_REGEX = /\bcount\s*\(/i;
const METADATA_SQL_REGEX =
  /\bsqlite_master\b|\bsqlite_schema\b|\binformation_schema\b|\bpg_catalog\b|\bshow\s+tables\b|\bdescribe\b|\bpragma\b/i;

export interface SqlDraft {
  provider: string;
  model: string;
  modelCatalogId?: string;
  sql: string;
  explanation: string;
  rawText: string;
  prompt: LlmGatewayPrompt;
  promptTemplate?: PromptTemplateTraceEvidence;
  retryCount?: number;
  semanticIntent?: SqlSemanticIntent;
}

@Injectable()
export class SqlGenerationService {
  constructor(
    private readonly promptBuilder: SqlPromptBuilder,
    private readonly extractor: SqlOutputExtractor,
    private readonly providerRouter: ProviderRouterService,
    private readonly promptTemplateService: PromptTemplateService
  ) {}

  async generate(
    question: string,
    selection?: SqlGenerationSelection
  ): Promise<SqlDraft> {
    const templateResolution = await this.resolvePromptTemplate(selection);
    const semanticIntent = this.resolveSemanticIntent(
      question,
      selection?.semanticIntent
    );
    const prompt = this.buildPrompt(
      question,
      selection,
      templateResolution.templateOverlay,
      semanticIntent
    );
    const completion = await this.providerRouter.generate(prompt, selection);
    return this.finalizeWithSemanticGuardrails({
      question,
      selection,
      semanticIntent,
      prompt,
      completion,
      templateOverlay: templateResolution.templateOverlay,
      promptTemplate: templateResolution.evidence
    });
  }

  async stream(
    question: string,
    selection?: SqlGenerationSelection,
    options?: {
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<SqlDraft> {
    const templateResolution = await this.resolvePromptTemplate(selection);
    const semanticIntent = this.resolveSemanticIntent(
      question,
      selection?.semanticIntent
    );
    const prompt = this.buildPrompt(
      question,
      selection,
      templateResolution.templateOverlay,
      semanticIntent
    );
    let completion: LlmDraft;
    try {
      completion = await this.providerRouter.stream(prompt, selection, options);
    } catch (error) {
      if (!this.shouldRetryAsNonStream(error)) {
        throw error;
      }

      completion = await this.providerRouter.generate(prompt, selection);
    }
    return this.finalizeWithSemanticGuardrails({
      question,
      selection,
      semanticIntent,
      prompt,
      completion,
      templateOverlay: templateResolution.templateOverlay,
      promptTemplate: templateResolution.evidence
    });
  }

  private shouldRetryAsNonStream(error: unknown): boolean {
    if (!(error instanceof DomainError)) {
      return false;
    }
    return (
      error.code === "LLM_TOOL_CALL_ONLY_RESPONSE" ||
      error.code === "LLM_SQL_EXTRACT_FAILED"
    );
  }

  private buildPrompt(
    question: string,
    selection: SqlGenerationSelection | undefined,
    templateOverlay: string | undefined,
    semanticIntent: SqlSemanticIntent,
    retryReason?: string
  ): LlmGatewayPrompt {
    return this.promptBuilder.build(
      question,
      selection?.datasourceType,
      selection?.selectedContext,
      {
        templateOverlay,
        semanticGuardrail: {
          intent: semanticIntent,
          retryReason
        },
        semanticContextPack: selection?.semanticContextPack
      }
    );
  }

  private async finalizeWithSemanticGuardrails(input: {
    question: string;
    selection: SqlGenerationSelection | undefined;
    semanticIntent: SqlSemanticIntent;
    prompt: LlmGatewayPrompt;
    completion: LlmDraft;
    templateOverlay?: string;
    promptTemplate: PromptTemplateTraceEvidence;
  }): Promise<SqlDraft> {
    let retryCount = 0;
    let prompt = input.prompt;
    let completion = input.completion;

    while (true) {
      try {
        const extracted = this.extractor.extract(completion.rawText);
        const validation = this.validateSemanticIntent(
          input.semanticIntent,
          extracted.sql
        );
        if (validation.valid) {
          return {
            provider: completion.provider,
            model: completion.model,
            modelCatalogId: completion.modelCatalogId,
            sql: extracted.sql,
            explanation: extracted.explanation || completion.rawText,
            rawText: completion.rawText,
            prompt,
            promptTemplate: input.promptTemplate,
            retryCount,
            semanticIntent: input.semanticIntent
          };
        }

        if (retryCount >= MAX_SEMANTIC_REPAIR_RETRY) {
          throw new DomainError(
            "LLM_SQL_SEMANTIC_GUARDRAIL_FAILED",
            "SQL 语义护栏校验失败，且一次修复重试后仍未通过。",
            502,
            {
              semanticIntent: input.semanticIntent,
              reason: validation.reason,
              sql: extracted.sql.slice(0, 400)
            }
          );
        }

        retryCount += 1;
        prompt = this.buildPrompt(
          input.question,
          input.selection,
          input.templateOverlay,
          input.semanticIntent,
          validation.reason
        );
        completion = await this.providerRouter.generate(prompt, input.selection);
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "LLM_SQL_EXTRACT_FAILED") {
          throw error;
        }
        if (retryCount >= MAX_SEMANTIC_REPAIR_RETRY) {
          throw error;
        }
        retryCount += 1;
        prompt = this.buildPrompt(
          input.question,
          input.selection,
          input.templateOverlay,
          input.semanticIntent,
          "no executable SQL was extracted from the previous output"
        );
        completion = await this.providerRouter.generate(prompt, input.selection);
      }
    }
  }

  private resolveSemanticIntent(
    question: string,
    explicitIntent?: SqlSemanticIntent
  ): SqlSemanticIntent {
    if (explicitIntent && explicitIntent !== "general") {
      return explicitIntent;
    }
    if (METADATA_INTENT_REGEX.test(question)) {
      return "metadata";
    }
    if (COUNT_INTENT_REGEX.test(question)) {
      return "count";
    }
    return explicitIntent ?? "general";
  }

  private validateSemanticIntent(
    intent: SqlSemanticIntent,
    sql: string
  ): {
    valid: boolean;
    reason?: string;
  } {
    if (intent === "general") {
      return { valid: true };
    }

    if (intent === "count") {
      if (METADATA_SQL_REGEX.test(sql)) {
        return {
          valid: false,
          reason: "count-intent requires business counting SQL, but metadata introspection SQL was produced"
        };
      }
      if (!COUNT_SQL_REGEX.test(sql)) {
        return {
          valid: false,
          reason: "count-intent requires COUNT(...) aggregation"
        };
      }
      return { valid: true };
    }

    if (!METADATA_SQL_REGEX.test(sql)) {
      return {
        valid: false,
        reason:
          "metadata-intent requires schema/table introspection SQL (sqlite_master/information_schema/SHOW TABLES/pragma)"
      };
    }
    return { valid: true };
  }

  private async resolvePromptTemplate(selection?: {
    datasourceId?: string;
    workspaceId?: string;
  }): Promise<{
    templateOverlay?: string;
    evidence: PromptTemplateTraceEvidence;
  }> {
    try {
      const resolved = await this.promptTemplateService.resolveSqlTemplateRuntime({
        datasourceId: selection?.datasourceId,
        workspaceId: selection?.workspaceId
      });
      return {
        templateOverlay: resolved.template?.content,
        evidence: resolved.evidence
      };
    } catch {
      return {
        evidence: {
          scene: "sql",
          fallbackReason: "template_service_error"
        }
      };
    }
  }
}
