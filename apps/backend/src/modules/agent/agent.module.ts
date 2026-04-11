import { Module } from "@nestjs/common";
import { DataModule } from "../data/data.module";
import { LlmModule } from "../llm/llm.module";
import { ObservabilityModule } from "../observability/observability.module";
import { GraphBuilderService } from "./graph/graph.builder";
import { LangGraphRuntimeService } from "./graph/langgraph.runtime";
import { ClarifyNode } from "./nodes/clarify.node";
import { GenerateSqlNode } from "./nodes/generate-sql.node";
import { SafetyCheckNode } from "./nodes/safety-check.node";
import { ExecuteSqlNode } from "./nodes/execute-sql.node";
import { FormatAnswerNode } from "./nodes/format-answer.node";
import { SqlGenerationService } from "./sql/sql-generation.service";
import { SqlOutputExtractor } from "./sql/sql-output-extractor";
import { SqlPromptBuilder } from "./sql/sql-prompt.builder";
import { SqlReadonlyTool } from "./sql/tools/sql-readonly.tool";
import { SqlSafetyGuard } from "./sql/tools/sql-safety.guard";
import { SqlToolRegistryService } from "./sql/tools/sql-tool-registry.service";

@Module({
  imports: [DataModule, LlmModule, ObservabilityModule],
  providers: [
    GraphBuilderService,
    LangGraphRuntimeService,
    ClarifyNode,
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
