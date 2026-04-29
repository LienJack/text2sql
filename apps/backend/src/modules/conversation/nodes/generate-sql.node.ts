import { Injectable } from "@nestjs/common";
import type {
  SqlCorrectionGroundingV1,
  DatasourceType,
  PromptTemplateTraceEvidence,
  SemanticContextPackV1,
  SemanticPlanV1,
  Text2SqlV2SmartDefaultsEvidenceV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import type {
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../llm/llm-gateway.interface";
import {
  SqlGenerationService,
  type SqlEvidenceCoverage,
  type SqlGenerationCause,
  type SqlGenerationExplicitPinningEvidence,
  type StructuredSqlGenerationArtifact
} from "../agent/sql/sql-generation.service";
import type { SqlSemanticIntent } from "../agent/sql/sql-prompt.builder";
import type {
  RagContextPack,
  RagRetrievalChunkPayload
} from "../../knowledge";

export interface GenerateSqlNodeResult {
  draft: {
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
    smartDefaults?: Text2SqlV2SmartDefaultsEvidenceV1;
    retryCount?: number;
    semanticIntent?: SqlSemanticIntent;
    coverage?: SqlEvidenceCoverage;
    semanticPlan?: SemanticPlanV1;
    semanticContextPack?: SemanticContextPackV1;
  };
  artifact: StructuredSqlGenerationArtifact;
}

@Injectable()
export class GenerateSqlNode {
  constructor(private readonly sqlGenerationService: SqlGenerationService) {}

  async run(input: {
    question: string;
    datasourceType?: DatasourceType;
    modelCatalogId?: string;
    datasourceId?: string;
    workspaceId?: string;
    semanticIntent?: SqlSemanticIntent;
    selectedContext?: RagRetrievalChunkPayload[];
    semanticContextPack?: RagContextPack;
    semanticPlan: SemanticPlanV1;
    explicitPinning?: SqlGenerationExplicitPinningEvidence;
    cause?: SqlGenerationCause;
    retryReason?: string;
    correctionGrounding?: SqlCorrectionGroundingV1;
    stream?: boolean;
    tools?: Record<string, LlmGatewayToolDefinition>;
    onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
  }): Promise<GenerateSqlNodeResult> {
    const routeKind = this.resolveRouteKind(input.semanticPlan);
    if (routeKind !== "text_to_sql") {
      throw new DomainError(
        "SEMANTIC_PLAN_DIRECT_ANSWER_REQUIRED",
        `semantic-plan route ${routeKind} cannot enter generate-sql node`,
        422,
        {
          semanticPlan: input.semanticPlan,
          routeKind
        }
      );
    }
    const blockedObligationIds =
      input.semanticPlan.planLedger?.summary.failedHardBlockerIds ?? [];
    if (blockedObligationIds.length > 0) {
      throw new DomainError(
        "SEMANTIC_PLAN_LEDGER_GATE_BLOCKED",
        "semantic-plan ledger gate blocked SQL generation",
        422,
        {
          semanticPlan: input.semanticPlan,
          blockedObligationIds
        }
      );
    }

    const draft = input.stream
      ? await this.sqlGenerationService.stream(
          input.question,
          {
            datasourceId: input.datasourceId,
            workspaceId: input.workspaceId,
            datasourceType: input.datasourceType,
            modelCatalogId: input.modelCatalogId,
            selectedContext: input.selectedContext,
            semanticContextPack: input.semanticContextPack,
            semanticIntent: input.semanticIntent,
            explicitPinning: input.explicitPinning,
            semanticPlan: input.semanticPlan,
            correctionGrounding: input.correctionGrounding
          },
          {
            tools: input.tools,
            onEvent: input.onEvent
          }
        )
      : await this.sqlGenerationService.generate(input.question, {
          datasourceId: input.datasourceId,
          workspaceId: input.workspaceId,
          datasourceType: input.datasourceType,
          modelCatalogId: input.modelCatalogId,
          selectedContext: input.selectedContext,
          semanticContextPack: input.semanticContextPack,
          semanticIntent: input.semanticIntent,
          explicitPinning: input.explicitPinning,
          semanticPlan: input.semanticPlan,
          correctionGrounding: input.correctionGrounding
        });

    return {
      draft: {
        ...draft,
        semanticContextPack: this.toNodeContextPack(
          draft.semanticPlan,
          input.semanticContextPack
        )
      },
      artifact: this.sqlGenerationService.buildStructuredArtifact({
        draft,
        datasourceType: input.datasourceType,
        cause: input.cause ?? "initial",
        retryReason: input.retryReason,
        correctionGrounding: input.correctionGrounding
      })
    };
  }

  private resolveRouteKind(
    plan: SemanticPlanV1
  ): "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed" {
    const routeFilter = plan.filters?.find((item) => item.startsWith("route_kind:"));
    if (routeFilter) {
      const value = routeFilter.slice("route_kind:".length).trim();
      if (
        value === "text_to_sql" ||
        value === "metadata" ||
        value === "general" ||
        value === "clarify" ||
        value === "fail_closed"
      ) {
        return value;
      }
    }
    if (plan.route === "clarify") {
      return "clarify";
    }
    if (plan.route === "reject") {
      return "fail_closed";
    }
    return "text_to_sql";
  }

  private toNodeContextPack(
    semanticPlan: SemanticPlanV1 | undefined,
    contextPack?: RagContextPack
  ): SemanticContextPackV1 | undefined {
    if (!contextPack) {
      return undefined;
    }
    return {
      status: contextPack.status,
      selectedEvidenceIds: semanticPlan?.evidenceRefs ?? [],
      selectedTables: semanticPlan?.selectedTables ?? [],
      selectedColumns: semanticPlan?.selectedColumns ?? [],
      warnings: contextPack.degrade_reasons
    };
  }
}
