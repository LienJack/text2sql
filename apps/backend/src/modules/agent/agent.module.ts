import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { PlatformDataQueryModule } from "../platform/data/query.module";
import { DatasourceModule } from "../governance/datasource/datasource.module";
import { GovernanceAccessModule } from "../governance/access/access.module";
import { LlmModule } from "../llm/llm.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RagModule } from "../rag/rag.module";
import { SemanticRegistryModule } from "../semantic-registry/semantic-registry.module";
import { SettingsModule } from "../governance/settings/settings.module";
import { BuildIntentPlanNode } from "./nodes/build-intent-plan.node";
import { BuildPhysicalPlanNode } from "./nodes/build-physical-plan.node";
import { BuildSemanticQueryNode } from "./nodes/build-semantic-query.node";
import { GraphBuilderService } from "./graph/graph.builder";
import { LangGraphRuntimeService } from "./graph/langgraph.runtime";
import { ClarifyNode } from "./nodes/clarify.node";
import { GenerateSqlNode } from "./nodes/generate-sql.node";
import { SafetyCheckNode } from "./nodes/safety-check.node";
import { ExecuteSqlNode } from "./nodes/execute-sql.node";
import { FormatAnswerNode } from "./nodes/format-answer.node";
import { RetrieveKnowledgeNode } from "./nodes/retrieve-knowledge.node";
import { SqlGenerationService } from "./sql/sql-generation.service";
import { SqlOutputExtractor } from "./sql/sql-output-extractor";
import { SqlPromptBuilder } from "./sql/sql-prompt.builder";
import { SqlReadonlyTool } from "./sql/tools/sql-readonly.tool";
import { SqlSafetyGuard } from "./sql/tools/sql-safety.guard";
import { SqlToolRegistryService } from "./sql/tools/sql-tool-registry.service";
import { PlannerVersionLockService } from "./planner/planner-version-lock.service";
import { PlannerCacheService } from "./planner/planner-cache.service";

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
    RagModule,
    SemanticRegistryModule
  ],
  providers: [
    GraphBuilderService,
    LangGraphRuntimeService,
    ClarifyNode,
    RetrieveKnowledgeNode,
    BuildIntentPlanNode,
    PlannerVersionLockService,
    PlannerCacheService,
    BuildSemanticQueryNode,
    BuildPhysicalPlanNode,
    GenerateSqlNode,
    SafetyCheckNode,
    ExecuteSqlNode,
    FormatAnswerNode,
    SqlPromptBuilder,
    SqlOutputExtractor,
    SqlGenerationService,
    SqlSafetyGuard,
    SqlReadonlyTool,
    SqlToolRegistryService
  ],
  exports: [
    GraphBuilderService,
    ClarifyNode,
    SafetyCheckNode,
    ExecuteSqlNode,
    FormatAnswerNode,
    SqlToolRegistryService
  ]
})
export class AgentModule {}
