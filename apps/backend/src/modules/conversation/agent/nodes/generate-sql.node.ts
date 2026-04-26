import { Injectable, Optional } from "@nestjs/common";
import type {
  DatasourceType,
  PromptTemplateTraceEvidence,
  SemanticContextPackV1,
  SemanticPlanV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import type {
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../../llm/llm-gateway.interface";
import {
  SqlGenerationService,
  type SqlEvidenceCoverage,
  type SqlGenerationExplicitPinningEvidence
} from "../sql/sql-generation.service";
import type { SqlSemanticIntent } from "../sql/sql-prompt.builder";
import type {
  RagRetrievalBundle,
  RagContextPack,
  RagRetrievalChunkPayload
} from "../../../knowledge/rag/retrieval/rag-retrieval.types";
import { SemanticContextPackService } from "../v2/semantic-context-pack.service";
import { SemanticPlanService } from "../v2/semantic-plan.service";
import { SemanticPlanValidator } from "../v2/semantic-plan.validator";

@Injectable()
export class GenerateSqlNode {
  constructor(
    private readonly sqlGeneration: SqlGenerationService,
    @Optional()
    private readonly semanticContextPackService?: SemanticContextPackService,
    @Optional()
    private readonly semanticPlanService?: SemanticPlanService
  ) {}

  async run(
    question: string,
    datasourceType?: DatasourceType,
    modelCatalogId?: string,
    options?: {
      stream?: boolean;
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
      selectedContext?: RagRetrievalChunkPayload[];
      retrievalBundle?: RagRetrievalBundle;
      semanticContextPack?: RagContextPack;
      datasourceId?: string;
      workspaceId?: string;
      semanticIntent?: SqlSemanticIntent;
      explicitPinning?: SqlGenerationExplicitPinningEvidence;
      allowedTables?: string[];
    }
  ): Promise<{
    provider: string;
    model: string;
    modelCatalogId?: string;
    sql: string;
    explanation: string;
    rawText: string;
    prompt: {
      systemPrompt: string;
      userPrompt: string;
    };
    promptTemplate?: PromptTemplateTraceEvidence;
    retryCount?: number;
    semanticIntent?: SqlSemanticIntent;
    coverage?: SqlEvidenceCoverage;
    semanticContextPack?: SemanticContextPackV1;
    semanticPlan?: SemanticPlanV1;
  }> {
    const semanticContextPackService =
      this.semanticContextPackService ?? new SemanticContextPackService();
    const semanticPlanService =
      this.semanticPlanService ??
      new SemanticPlanService(new SemanticPlanValidator());

    const semanticContextPack = semanticContextPackService.build({
      retrievalBundle: options?.retrievalBundle,
      selectedContext: options?.selectedContext,
      additionalWarnings: options?.semanticContextPack?.degrade_reasons
    });
    const semanticPlanResult = semanticPlanService.build({
      question,
      contextPack: semanticContextPack,
      semanticIntent: options?.semanticIntent,
      allowedTables: options?.allowedTables
    });
    if (semanticPlanResult.plan.route === "reject") {
      throw new DomainError(
        "SEMANTIC_PLAN_FAIL_CLOSED",
        "语义计划进入 fail-closed 路径，已阻止 SQL 生成。",
        422,
        {
          validation: semanticPlanResult.validation,
          semanticPlan: semanticPlanResult.plan
        }
      );
    }
    if (semanticPlanResult.plan.route === "clarify") {
      throw new DomainError(
        "SEMANTIC_PLAN_REQUIRES_CLARIFICATION",
        "语义计划要求先澄清问题，已阻止 SQL 生成。",
        422,
        {
          validation: semanticPlanResult.validation,
          semanticPlan: semanticPlanResult.plan
        }
      );
    }
    if (
      !semanticPlanResult.validation.valid &&
      semanticPlanResult.validation.reasons.some(
        (reason) =>
          reason === "plan_contains_unsupported_tables" ||
          reason === "plan_contains_unsupported_columns"
      )
    ) {
      throw new DomainError(
        "SEMANTIC_PLAN_VALIDATION_FAILED",
        "语义计划包含未授权或不支持的表/字段，已阻止 SQL 生成。",
        422,
        {
          validation: semanticPlanResult.validation,
          semanticPlan: semanticPlanResult.plan
        }
      );
    }

    if (options?.stream) {
      const draft = await this.sqlGeneration.stream(
        question,
        {
          datasourceId: options.datasourceId,
          workspaceId: options.workspaceId,
          datasourceType,
          modelCatalogId,
          selectedContext: options.selectedContext,
          semanticContextPack: options.semanticContextPack,
          semanticIntent: options.semanticIntent,
          explicitPinning: options.explicitPinning,
          semanticPlan: semanticPlanResult.plan
        },
        {
          tools: options.tools,
          onEvent: options.onEvent
        }
      );
      return {
        ...draft,
        semanticContextPack,
        semanticPlan: semanticPlanResult.plan
      };
    }
    const draft = await this.sqlGeneration.generate(question, {
      datasourceId: options?.datasourceId,
      workspaceId: options?.workspaceId,
      datasourceType,
      modelCatalogId,
      selectedContext: options?.selectedContext,
      semanticContextPack: options?.semanticContextPack,
      semanticIntent: options?.semanticIntent,
      explicitPinning: options?.explicitPinning,
      semanticPlan: semanticPlanResult.plan
    });
    return {
      ...draft,
      semanticContextPack,
      semanticPlan: semanticPlanResult.plan
    };
  }
}
