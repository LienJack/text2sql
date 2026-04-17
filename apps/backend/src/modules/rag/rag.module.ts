import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { LlmModule } from "../llm/llm.module";
import { ObservabilityModule } from "../observability/observability.module";
import { SkillRegistryModule } from "../skill-registry/skill-registry.module";
import { RagIndexBuilderService } from "./index/rag-index-builder.service";
import { RagIndexRepository } from "./index/rag-index.repository";
import { BuildRagIndexJob } from "./jobs/build-rag-index.job";
import { RagReplayRepository } from "./observability/rag-replay.repository";
import { RagQualityController } from "./quality/rag-quality.controller";
import { RagQualityService } from "./quality/rag-quality.service";
import { RagRetrievalService } from "./retrieval/rag-retrieval.service";
import { ModelRerankerAdapter } from "./rerank/model-reranker.adapter";
import { RagRerankService } from "./rerank/rag-rerank.service";

@Module({
  imports: [AppConfigModule, LlmModule, ObservabilityModule, SkillRegistryModule],
  controllers: [RagQualityController],
  providers: [
    RagIndexRepository,
    RagIndexBuilderService,
    BuildRagIndexJob,
    RagReplayRepository,
    RagQualityService,
    RagRetrievalService,
    ModelRerankerAdapter,
    RagRerankService
  ],
  exports: [
    RagIndexRepository,
    RagIndexBuilderService,
    BuildRagIndexJob,
    RagReplayRepository,
    RagQualityService,
    RagRetrievalService,
    ModelRerankerAdapter,
    RagRerankService
  ]
})
export class RagModule {}
