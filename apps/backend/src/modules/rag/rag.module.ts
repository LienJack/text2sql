import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { PlatformDataModule } from "../platform/data/data.module";
import { GraphAccelerationAdapter } from "../knowledge/graph/adapter/graph-acceleration.adapter";
import { GraphAccelerationCircuitBreaker } from "../knowledge/graph/adapter/graph-acceleration-circuit-breaker";
import { GraphService } from "../knowledge/graph/graph.service";
import { LlmModule } from "../llm/llm.module";
import { ObservabilityModule } from "../observability/observability.module";
import { SkillRegistryModule } from "../skill-registry/skill-registry.module";
import { RagAuditReplayService } from "./audit/rag-audit-replay.service";
import { RagEventConsumerService } from "./events/rag-event-consumer.service";
import { RagIndexBuilderService } from "./index/rag-index-builder.service";
import { RagIndexRepository } from "./index/rag-index.repository";
import { BuildRagIndexJob } from "./jobs/build-rag-index.job";
import { RagReplayRepository } from "./observability/rag-replay.repository";
import { RagDatasourceOrchestratorService } from "./orchestration/rag-datasource-orchestrator.service";
import { RagDatasourceQuotaPolicy } from "./orchestration/rag-datasource-quota.policy";
import { RagBudgetPolicy } from "./perf/rag-budget-policy";
import { RagCacheKeyFactory } from "./perf/rag-cache-key.factory";
import { RagQueryCacheService } from "./perf/rag-query-cache.service";
import { RagQualityController } from "./quality/rag-quality.controller";
import { RagQualityService } from "./quality/rag-quality.service";
import { RagRetrievalService } from "./retrieval/rag-retrieval.service";
import { ModelRerankerAdapter } from "./rerank/model-reranker.adapter";
import { RagRerankService } from "./rerank/rag-rerank.service";

@Module({
  imports: [
    AppConfigModule,
    PlatformDataModule,
    LlmModule,
    ObservabilityModule,
    SkillRegistryModule
  ],
  controllers: [RagQualityController],
  providers: [
    RagIndexRepository,
    RagIndexBuilderService,
    BuildRagIndexJob,
    RagDatasourceQuotaPolicy,
    RagDatasourceOrchestratorService,
    GraphAccelerationAdapter,
    GraphAccelerationCircuitBreaker,
    GraphService,
    RagBudgetPolicy,
    RagCacheKeyFactory,
    RagQueryCacheService,
    RagEventConsumerService,
    RagAuditReplayService,
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
    RagDatasourceQuotaPolicy,
    RagDatasourceOrchestratorService,
    GraphAccelerationAdapter,
    GraphAccelerationCircuitBreaker,
    GraphService,
    RagBudgetPolicy,
    RagCacheKeyFactory,
    RagQueryCacheService,
    RagEventConsumerService,
    RagAuditReplayService,
    RagReplayRepository,
    RagQualityService,
    RagRetrievalService,
    ModelRerankerAdapter,
    RagRerankService
  ]
})
export class RagModule {}
