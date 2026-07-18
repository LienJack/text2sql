import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { ok } from "../../common/api-response";
import { AppConfigService } from "../config/app-config.service";
import { RedisBufferService } from "../data/cache/redis-buffer.service";
import { ChatRepository } from "../data/persistence/chat.repository";
import { SqliteQueryService } from "../data/sqlite/sqlite-query.service";
import { DatasourceService } from "../governance/datasource/datasource.service";
import { DatasourceRegistryService } from "../governance/datasource/datasource-registry.service";
import { GateMetricsService } from "../observability/gate-metrics.service";
import { RagIngestionMetricsService } from "../rag/observability/rag-ingestion-metrics.service";
import { RagQualityService } from "../rag/quality/rag-quality.service";
import { SemanticAssetReadinessService } from "../knowledge/rag/preparation/semantic-asset-readiness.service";
import { SemanticSpineShadowGateService } from "../observability/semantic-spine-shadow-gate.service";
import { RagTaskConfigService } from "../llm/rag-task-config.service";
import { AnalysisCommandOutboxRepository } from "../platform/data/persistence/analysis-command-outbox.repository";
import { AnalysisLedgerPrismaService } from "../platform/data/persistence/analysis-ledger-prisma.service";
import { DurableWorkflowPort } from "../platform/durable/contracts/durable-workflow.port";
import { AnalysisTelemetryService } from "../platform/observability/analysis-telemetry.service";

@Controller()
export class HealthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly sqlite: SqliteQueryService,
    private readonly redis: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly datasourceService: DatasourceService,
    private readonly datasourceRegistry: DatasourceRegistryService,
    private readonly gateMetrics: GateMetricsService,
    private readonly ragIngestionMetrics: RagIngestionMetricsService,
    private readonly ragQuality: RagQualityService,
    private readonly semanticAssetReadiness: SemanticAssetReadinessService,
    private readonly semanticSpineShadow: SemanticSpineShadowGateService,
    private readonly ragTaskConfigService: RagTaskConfigService,
    private readonly analysisLedger: AnalysisLedgerPrismaService,
    private readonly analysisOutbox: AnalysisCommandOutboxRepository,
    private readonly durableWorkflow: DurableWorkflowPort,
    private readonly analysisTelemetry: AnalysisTelemetryService
  ) {}

  private async buildHealthResponse(req: Request): Promise<ApiResponse<unknown>> {
    const sqliteReady = await this.sqlite.healthCheck();
    const redisReady = await this.redis.healthCheck();
    const sessionSyncStats = await this.repository.getSessionSyncStats();
    const datasources = await this.datasourceService.listDatasources({
      includeUnavailable: true
    });
    const postgresEnabled = Boolean(this.config.databaseUrl);
    const ragQualityGate = this.ragQuality.snapshot();
    const semanticAssetReadiness = await this.semanticAssetReadiness.snapshot();
    const semanticSpineShadowGate = this.semanticSpineShadow.snapshot();
    const ragConfigView = await this.ragTaskConfigService.listSettingsView({
      id: "system-health",
      role: "admin"
    });
    const embeddingConfig =
      ragConfigView.items.find((item) => item.taskType === "embedding") ?? null;
    const rerankConfig =
      ragConfigView.items.find((item) => item.taskType === "rerank") ?? null;
    const durableHealth = await this.durableWorkflow.health();
    const analysisOutboxBacklog = this.analysisLedger.isReady()
      ? await this.analysisOutbox.backlogCount().catch(() => null)
      : null;
    return ok(req.requestId, {
      status:
        sqliteReady &&
        this.analysisLedger.isReady() &&
        (durableHealth.provider === "in_memory" || durableHealth.clientReady)
          ? "ok"
          : "degraded",
      runtime: {
        nodeEnv: this.config.nodeEnv,
        port: this.config.port
      },
      dependencies: {
        authentication: {
          mode: this.config.authMode,
          trustedBoundary:
            this.config.authMode === "oidc_bearer" ? "verified" : "development_only",
          headerActorEnabled: this.config.authHeaderActorEnabled,
          policyVersion: this.config.authPolicyVersion,
          oidc: {
            issuerConfigured: Boolean(this.config.authOidcIssuer),
            audienceConfigured: this.config.authOidcAudience.length > 0,
            jwksConfigured: Boolean(this.config.authOidcJwksUrl),
            allowedAlgorithms: this.config.authOidcAllowedAlgorithms
          }
        },
        sqlite: {
          ready: sqliteReady,
          path: this.config.sqlitePath
        },
        redis: {
          ready: redisReady,
          configured: Boolean(this.config.redisUrl)
        },
        postgres: {
          configured: postgresEnabled
        },
        analysisRuntime: {
          canonicalStore: {
            provider: "postgresql",
            configured: postgresEnabled,
            ready: this.analysisLedger.isReady()
          },
          durableWorkflow: durableHealth,
          commandOutbox: {
            backlog: analysisOutboxBacklog,
            ready: analysisOutboxBacklog !== null
          },
          telemetry: this.analysisTelemetry.snapshot()
        },
        llm: {
          provider: this.config.llmProvider,
          configured: Boolean(this.config.llmApiKey),
          baseUrlConfigured: Boolean(this.config.llmBaseUrl),
          model: this.config.llmModel,
          mockMode: this.config.llmMockMode,
          gateway: "vercel-ai-sdk-core",
          contractVersion: "agent-first-v1",
          streamingEnabled: true,
          streamEndpoint: "/api/v1/sessions/:sessionId/messages/stream",
          eventRequiredFields: ["type", "runId", "sessionId", "at", "data"],
          toolCallingEnabled: true,
          toolRegistry: ["runReadOnlySql"]
        },
        langsmith: {
          tracingRequested: this.config.langsmithTracing,
          configured: this.config.langsmithConfigured,
          ready: this.config.langsmithReady,
          project: this.config.langsmithProject,
          endpoint: this.config.langsmithEndpoint
        },
        sessions: {
          sync: sessionSyncStats
        },
        gateMetrics: {
          acceptance: this.gateMetrics.snapshot()
        },
        ragIngestionMetrics: {
          foundation: this.ragIngestionMetrics.snapshot()
        },
        ragQuality: {
          gate: ragQualityGate,
          r6: ragQualityGate.r6
        },
        ragConfig: {
          embedding: embeddingConfig
            ? {
                provider: embeddingConfig.provider,
                model: embeddingConfig.model,
                configSource: embeddingConfig.configSource,
                healthStatus: embeddingConfig.healthStatus
              }
            : null,
          rerank: rerankConfig
            ? {
                provider: rerankConfig.provider,
                model: rerankConfig.model,
                configSource: rerankConfig.configSource,
                healthStatus: rerankConfig.healthStatus
              }
            : null,
          semanticAssetReadiness
        },
        semanticSpineShadow: {
          gate: semanticSpineShadowGate
        },
        text2sqlAccuracy: {
          mode: this.config.text2sqlAccuracyMode,
          supportedSlices: this.config.text2sqlAccuracySupportedSlices,
          supportedDialects: ["sqlite", "mysql", "postgresql"],
          guidelineDigest: this.config.text2sqlAccuracyGuidelineDigest,
          capabilities: {
            parser: "available",
            frozenCatalog: "available",
            explain: {
              sqlite: "available",
              mysql: "available",
              postgresql: "available"
            },
            cancellation: "available",
            boundedReadOnlyExecution: "available",
            deterministicResultOracles: "available",
            safeReplaySummary: "available"
          }
        }
      },
      cors: {
        allowedOrigins: this.config.corsAllowedOrigins,
        allowedHeaders: this.config.corsAllowedHeaders
      },
      datasources
    });
  }

  @Get("/health")
  async health(@Req() req: Request): Promise<ApiResponse<unknown>> {
    return this.buildHealthResponse(req);
  }

  @Get("/api/health")
  async healthApi(@Req() req: Request): Promise<ApiResponse<unknown>> {
    return this.buildHealthResponse(req);
  }
}
