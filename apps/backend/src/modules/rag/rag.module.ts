import { Module } from "@nestjs/common";
import { RagModule as KnowledgeRagModule } from "../knowledge/rag/rag.module";

@Module({
  imports: [KnowledgeRagModule],
  exports: [KnowledgeRagModule]
})
export class RagModule {}
