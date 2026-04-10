import { Module } from "@nestjs/common";
import { DataModule } from "../data/data.module";
import { LlmModule } from "../llm/llm.module";
import { GraphBuilderService } from "./graph/graph.builder";
import { ClarifyNode } from "./nodes/clarify.node";
import { GenerateSqlNode } from "./nodes/generate-sql.node";
import { SafetyCheckNode } from "./nodes/safety-check.node";
import { ExecuteSqlNode } from "./nodes/execute-sql.node";
import { FormatAnswerNode } from "./nodes/format-answer.node";

@Module({
  imports: [DataModule, LlmModule],
  providers: [
    GraphBuilderService,
    ClarifyNode,
    GenerateSqlNode,
    SafetyCheckNode,
    ExecuteSqlNode,
    FormatAnswerNode
  ],
  exports: [GraphBuilderService]
})
export class AgentModule {}

