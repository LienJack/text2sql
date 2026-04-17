import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { DataModule } from "../data/data.module";
import { DatasourceModule } from "../datasource/datasource.module";
import { LlmModule } from "../llm/llm.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RagModule } from "../rag/rag.module";
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

@Module({
  imports: [
    AppConfigModule,
    DataModule,
    DatasourceModule,
    LlmModule,
    ObservabilityModule,
    RagModule
  ],
  providers: [
    GraphBuilderService,
    LangGraphRuntimeService,
    ClarifyNode,
    RetrieveKnowledgeNode,
    BuildIntentPlanNode,
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
