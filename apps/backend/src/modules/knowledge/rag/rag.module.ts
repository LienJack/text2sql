import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { GraphAccelerationAdapter } from "../graph/adapter/graph-acceleration.adapter";
import { GraphAccelerationCircuitBreaker } from "../graph/adapter/graph-acceleration-circuit-breaker";
import { GraphService } from "../graph/graph.service";
import { LlmModule } from "../../llm/llm.module";
import { ObservabilityModule } from "../../observability/observability.module";
import { SkillRegistryModule } from "../../skill-registry/skill-registry.module";
import { RagAuditReplayService } from "../../rag/audit/rag-audit-replay.service";
import { RagEventConsumerService } from "../../rag/events/rag-event-consumer.service";
import { RagIndexBuilderService } from "../../rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../rag/index/rag-index.repository";
import { BuildRagIndexJob } from "../../rag/jobs/build-rag-index.job";
import { RagReplayRepository as LegacyRagReplayRepository } from "../../rag/observability/rag-replay.repository";
import { RagReplayRepository } from "./observability/rag-replay.repository";
import { RagDatasourceOrchestratorService } from "../../rag/orchestration/rag-datasource-orchestrator.service";
import { RagDatasourceQuotaPolicy } from "../../rag/orchestration/rag-datasource-quota.policy";
import { RagBudgetPolicy } from "../../rag/perf/rag-budget-policy";
import { RagCacheKeyFactory } from "../../rag/perf/rag-cache-key.factory";
import { RagQueryCacheService } from "../../rag/perf/rag-query-cache.service";
import { RagQualityController } from "../../rag/quality/rag-quality.controller";
import { RagQualityService } from "../../rag/quality/rag-quality.service";
import { RagRetrievalService as LegacyRagRetrievalService } from "../../rag/retrieval/rag-retrieval.service";
import { RagRetrievalService } from "./retrieval/rag-retrieval.service";
import { ModelRerankerAdapter } from "../../rag/rerank/model-reranker.adapter";
import { RagRerankService as LegacyRagRerankService } from "../../rag/rerank/rag-rerank.service";
import { RagRerankService } from "./rerank/rag-rerank.service";

export const KNOWLEDGE_COMPAT_BRIDGE_RETIREMENT_WINDOW = "next-milestone";

export const KNOWLEDGE_RAG_COMPAT_BRIDGE = Object.freeze({
  capability: "rag",
  status: "active",
  lifecycle: "one-milestone",
  removeBy: KNOWLEDGE_COMPAT_BRIDGE_RETIREMENT_WINDOW
});

export interface KnowledgeCompatBridgeRetirementChecks {
  conversationImportsClosed: boolean;
  boundaryGatePassed: boolean;
  keyRegressionsPassed: boolean;
}

export function assertKnowledgeCompatBridgeRetirementReady(
  capability: string,
  checks: KnowledgeCompatBridgeRetirementChecks
): void {
  const blockers: string[] = [];
  if (!checks.conversationImportsClosed) {
    blockers.push("conversation imports are not fully migrated to knowledge facade contracts");
  }
  if (!checks.boundaryGatePassed) {
    blockers.push("backend capability boundary gate is not green");
  }
  if (!checks.keyRegressionsPassed) {
    blockers.push("key integration regressions are not green");
  }
  if (blockers.length > 0) {
    throw new Error(
      `[knowledge-compat-bridge:${capability}] retirement blocked: ${blockers.join("; ")}`
    );
  }
}

@Module({
  imports: [
    AppConfigModule,
    PlatformDataPersistenceModule,
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
    LegacyRagReplayRepository,
    RagQualityService,
    LegacyRagRetrievalService,
    ModelRerankerAdapter,
    LegacyRagRerankService,
    {
      provide: RagReplayRepository,
      useExisting: LegacyRagReplayRepository
    },
    {
      provide: RagRetrievalService,
      useExisting: LegacyRagRetrievalService
    },
    {
      provide: RagRerankService,
      useExisting: LegacyRagRerankService
    }
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
    LegacyRagReplayRepository,
    RagReplayRepository,
    RagQualityService,
    LegacyRagRetrievalService,
    RagRetrievalService,
    ModelRerankerAdapter,
    LegacyRagRerankService,
    RagRerankService
  ]
})
export class RagModule {}
