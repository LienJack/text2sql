import { Injectable } from "@nestjs/common";
import type { ChatMessage, ChatSessionView, Datasource, Session, SqlRun } from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { DatasourceService } from "../../../governance/datasource/datasource.service";
import { RedisBufferService } from "../../../platform/data/cache/index";
import { ChatRepository } from "../../../platform/data/persistence/index";
import { ChatDeliveryEnrichmentService } from "./shared/chat-delivery-enrichment.service";

export interface SessionViewInput {
  sessionId: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class RunViewUsecase {
  constructor(
    private readonly repository: ChatRepository,
    private readonly redisBuffer: RedisBufferService,
    private readonly datasourceService: DatasourceService,
    private readonly chatDeliveryEnrichmentService: ChatDeliveryEnrichmentService
  ) {}

  async listMessages(input: SessionViewInput): Promise<ChatMessage[]> {
    const session = await this.repository.getSessionById(input.sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, {
        sessionId: input.sessionId
      });
    }
    const persisted = await this.repository.getMessages(
      input.sessionId,
      input.page ?? 1,
      input.pageSize ?? 0
    );
    const buffered = await this.redisBuffer.getBufferedMessages(input.sessionId);
    const merged = [...persisted, ...buffered];
    const unique = new Map<string, ChatMessage>();
    for (const message of merged) {
      unique.set(message.id, message);
    }
    return Array.from(unique.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  async getSessionView(input: SessionViewInput): Promise<ChatSessionView> {
    const session = await this.repository.getSessionById(input.sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, {
        sessionId: input.sessionId
      });
    }
    const messages = await this.listMessages(input);
    const latestRunRaw = await this.repository.getLatestRunBySessionId(input.sessionId);
    const latestRun = latestRunRaw
      ? await this.attachSupportedDelivery(latestRunRaw)
      : undefined;
    return {
      session: await this.mergeDatasourceMetadata(session),
      messages,
      latestRun
    };
  }

  async getRunById(runId: string): Promise<SqlRun> {
    const run = await this.repository.getRunById(runId);
    if (!run) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, { runId });
    }
    const session = await this.repository.getSessionById(run.sessionId);
    if (!session) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, { runId });
    }
    return this.attachSupportedDelivery(run);
  }

  private async attachSupportedDelivery(run: SqlRun): Promise<SqlRun> {
    this.assertSupportedV2Run(run);
    return this.chatDeliveryEnrichmentService.attachDeliveryContract(run);
  }

  private assertSupportedV2Run(run: SqlRun): void {
    if (this.isSupportedV2Run(run)) {
      return;
    }
    throw new DomainError(
      "LEGACY_RUN_UNSUPPORTED",
      "该运行记录为历史兼容结构，需迁移后才能读取。",
      410,
      {
        runId: run.runId,
        expectedContract: "text2sql-v2-read-model",
        requiredMarkers: {
          version: "run.trace.v2.version === 'v2'",
          stageOrder: "run.trace.v2.stageOrder.length > 0",
          stageArtifacts: "run.trace.v2.stages.length > 0"
        },
        migrationRunbook:
          "docs/runbooks/text2sql-v2-hardcut-read-model-migration.md"
      }
    );
  }

  private isSupportedV2Run(run: SqlRun): boolean {
    const traceV2 = run.trace?.v2;
    const stageOrder = traceV2?.stageOrder;
    const stages = traceV2?.stages;
    if (!traceV2 || traceV2.version !== "v2") {
      return false;
    }
    if (!Array.isArray(stageOrder) || stageOrder.length === 0) {
      return false;
    }
    if (!Array.isArray(stages) || stages.length === 0) {
      return false;
    }
    return stages.every(
      (stage) =>
        typeof stage.stage === "string" &&
        stageOrder.includes(stage.stage)
    );
  }

  private async mergeDatasourceMetadata(
    session: Session,
    resolvedDatasource?: Datasource
  ): Promise<Session> {
    const datasource =
      resolvedDatasource ??
      (await this.datasourceService.getDatasourceById(session.datasource, {
        includeDeleted: true
      }));

    if (!datasource) {
      return {
        ...session,
        datasourceStatus: "deleted"
      };
    }

    return {
      ...session,
      datasourceName: datasource.name,
      datasourceType: datasource.type,
      datasourceStatus: this.normalizeDatasourceStatus(datasource.status)
    };
  }

  private normalizeDatasourceStatus(
    status: string | undefined | null
  ): "available" | "unavailable" | "deleted" {
    const normalized = status?.toLowerCase();
    if (normalized === "available") {
      return "available";
    }
    if (normalized === "deleted") {
      return "deleted";
    }
    if (
      normalized === "unavailable" ||
      normalized === "offline" ||
      normalized === "disconnected"
    ) {
      return "unavailable";
    }
    return "unavailable";
  }
}
