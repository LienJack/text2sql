import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { PlatformDataQueryModule } from "../../platform/data/query.module";
import { GovernanceAccessModule } from "../../governance/access/access.module";
import { DatasourceModule } from "../../governance/datasource/datasource.module";
import { LlmModule } from "../../llm/llm.module";
import { ObservabilityModule } from "../../observability/observability.module";
import {
  KNOWLEDGE_FACADE_CONTRACT,
  type KnowledgeFacadeContract
} from "../../knowledge/contracts/knowledge-facade.contract";
import { KnowledgeModule } from "../../knowledge/knowledge.module";
import { SemanticRegistryService } from "../../semantic-registry/semantic-registry.service";
import { SettingsModule } from "../../governance/settings/settings.module";
import { BuildIntentPlanNode } from "./nodes/build-intent-plan.node";
import { ClarifyNode } from "./nodes/clarify.node";
import { ClarificationFusionPolicy } from "./nodes/clarification-fusion.policy";
import { ClarificationSemanticEvaluatorService } from "./nodes/clarification-semantic-evaluator.service";
import { FormatAnswerNode } from "./nodes/format-answer.node";
import { RetrieveKnowledgeNode } from "./nodes/retrieve-knowledge.node";
import { BuildPhysicalPlanNode } from "./nodes/build-physical-plan.node";
import { BuildSemanticQueryNode } from "./nodes/build-semantic-query.node";
import { GenerateSqlNode } from "./nodes/generate-sql.node";
import { ResolveSavedPriorSqlNode } from "./nodes/resolve-saved-prior-sql.node";
import { SafetyCheckNode } from "./nodes/safety-check.node";
import { ExecuteSqlNode } from "./nodes/execute-sql.node";
import { SqlGenerationService } from "./sql/sql-generation.service";
import { SqlOutputExtractor } from "./sql/sql-output-extractor";
import { SqlPromptBuilder } from "./sql/sql-prompt.builder";
import { SqlReadonlyTool } from "./sql/tools/sql-readonly.tool";
import { SqlSafetyGuard } from "./sql/tools/sql-safety.guard";
import { SqlToolRegistryService } from "./sql/tools/sql-tool-registry.service";
import { PlannerVersionLockService } from "./planner/planner-version-lock.service";
import { PlannerCacheService } from "./planner/planner-cache.service";
import { SemanticContextPackService } from "./v2/semantic-context-pack.service";
import { SemanticPlanService } from "./v2/semantic-plan.service";
import { SemanticPlanValidator } from "./v2/semantic-plan.validator";
import { SqlValidationService } from "./v2/sql-validation.service";
import { SqlCorrectionService } from "./v2/sql-correction.service";
import { Text2SqlV2StateMachine } from "./v2/text2sql-v2-state-machine";
import { Text2SqlV2RunnerService } from "./v2/text2sql-v2-runner.service";

@Module({
  imports: [
    AppConfigModule,
    PlatformDataPersistenceModule,
    PlatformDataQueryModule,
    GovernanceAccessModule,
    DatasourceModule,
    LlmModule,
    SettingsModule,
    ObservabilityModule,
    KnowledgeModule
  ],
  providers: [
    {
      provide: SemanticRegistryService,
      useFactory: (
        knowledgeFacade: KnowledgeFacadeContract
      ): Pick<SemanticRegistryService, "resolveTerm"> =>
        knowledgeFacade.semanticRegistry.registry as Pick<
          SemanticRegistryService,
          "resolveTerm"
        >,
      inject: [KNOWLEDGE_FACADE_CONTRACT]
    },
    ClarifyNode,
    ClarificationSemanticEvaluatorService,
    ClarificationFusionPolicy,
    RetrieveKnowledgeNode,
    BuildIntentPlanNode,
    PlannerVersionLockService,
    PlannerCacheService,
    BuildSemanticQueryNode,
    BuildPhysicalPlanNode,
    ResolveSavedPriorSqlNode,
    GenerateSqlNode,
    SafetyCheckNode,
    ExecuteSqlNode,
    FormatAnswerNode,
    SqlPromptBuilder,
    SqlOutputExtractor,
    SqlGenerationService,
    SqlSafetyGuard,
    SqlReadonlyTool,
    SqlToolRegistryService,
    SemanticContextPackService,
    SemanticPlanService,
    SemanticPlanValidator,
    SqlValidationService,
    SqlCorrectionService,
    Text2SqlV2StateMachine,
    Text2SqlV2RunnerService
  ],
  exports: [
    SqlToolRegistryService,
    Text2SqlV2RunnerService
  ]
})
export class AgentModule {}
