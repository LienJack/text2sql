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
    private readonly ragQuality: RagQualityService
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
    return ok(req.requestId, {
      status: sqliteReady ? "ok" : "degraded",
      runtime: {
        nodeEnv: this.config.nodeEnv,
        port: this.config.port
      },
      dependencies: {
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
        }
      },
      cors: {
        allowedOrigins: this.config.corsAllowedOrigins
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
