import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { ok } from "../../common/api-response";
import { AppConfigService } from "../config/app-config.service";
import { RedisBufferService } from "../data/cache/redis-buffer.service";
import { SqliteQueryService } from "../data/sqlite/sqlite-query.service";
import { DatasourceRegistryService } from "../datasource/datasource-registry.service";

@Controller()
export class HealthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly sqlite: SqliteQueryService,
    private readonly redis: RedisBufferService,
    private readonly datasourceRegistry: DatasourceRegistryService
  ) {}

  @Get("/health")
  async health(@Req() req: Request): Promise<ApiResponse<unknown>> {
    const sqliteReady = await this.sqlite.healthCheck();
    const redisReady = await this.redis.healthCheck();
    const postgresEnabled = Boolean(this.config.databaseUrl);
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
          configured: Boolean(this.config.llmApiKey)
        }
      },
      datasources: this.datasourceRegistry.list()
    });
  }
}

