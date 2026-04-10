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

@Module({
  imports: [DataModule, LlmModule, ObservabilityModule],
  providers: [
    GraphBuilderService,
    LangGraphRuntimeService,
    ClarifyNode,
    GenerateSqlNode,
    SafetyCheckNode,
    ExecuteSqlNode,
    FormatAnswerNode
  ],
  exports: [GraphBuilderService]
})
export class AgentModule {}
