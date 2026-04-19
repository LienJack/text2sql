import { Injectable } from "@nestjs/common";
import type { ChatMessage, SqlRun } from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { GraphBuilderService } from "../../agent/graph/graph.builder";
import { DatasourceRegistryService } from "../../../governance/datasource/datasource-registry.service";
import { DatasourceService } from "../../../governance/datasource/datasource.service";
import { RedisBufferService } from "../../../platform/data/cache/index";
import { ChatRepository } from "../../../platform/data/persistence/index";
import { ChatDeliveryEnrichmentService } from "./shared/chat-delivery-enrichment.service";
import { ChatPolicyGuardService } from "./shared/chat-policy-guard.service";
import { ChatPostRunHooksService } from "./shared/chat-post-run-hooks.service";
import { ChatRunPersistenceService } from "./shared/chat-run-persistence.service";
import { DomainError } from "../../../../common/domain-error";

export interface ExecuteMessageInput {
  sessionId: string;
  message: string;
  requestId?: string;
}

@Injectable()
export class ExecuteMessageUsecase {
  constructor(
    private readonly graphBuilder: GraphBuilderService,
    private readonly datasourceService: DatasourceService,
    private readonly datasourceRegistry: DatasourceRegistryService,
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly chatPolicyGuardService: ChatPolicyGuardService,
    private readonly chatDeliveryEnrichmentService: ChatDeliveryEnrichmentService,
    private readonly chatRunPersistenceService: ChatRunPersistenceService,
    private readonly chatPostRunHooksService: ChatPostRunHooksService
  ) {}

  async executeMessage(input: ExecuteMessageInput): Promise<SqlRun> {
    const session = await this.repository.getSessionById(input.sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, {
        sessionId: input.sessionId
      });
    }
    await this.chatPolicyGuardService.assertSessionWritableByPolicy(session);
    const datasource = await this.datasourceService.assertDatasourceAvailable(
      session.datasource
    );
    const sqlAccessContext = await this.chatPolicyGuardService.resolveSqlAccessContext(
      session
    );

    const userMessage: ChatMessage = {
      id: uuidv4(),
      sessionId: input.sessionId,
      role: "user",
      content: input.message,
      createdAt: new Date().toISOString()
    };
    await this.redisBuffer.bufferMessage(userMessage);
    const userPersistResult = await this.repository.persistMessage(userMessage);
    await this.repository.ensureSessionTitleFromFirstMessage(
      input.sessionId,
      input.message
    );

    const run = await this.graphBuilder.run({
      runId: uuidv4(),
      sessionId: input.sessionId,
      question: input.message,
      datasourceId: session.datasource,
      datasourceType: datasource.type,
      modelCatalogId: session.modelCatalogId ?? undefined,
      accessContext: sqlAccessContext,
      traceContext: {
        source: "chat",
        route: "/api/v1/sessions/:sessionId/messages",
        requestId: input.requestId
      }
    });

    const finalRun = this.applyRejectedFallback(run, session.datasource);
    const runWithDelivery =
      await this.chatDeliveryEnrichmentService.attachDeliveryContract(finalRun);
    await this.chatRunPersistenceService.persistAssistantAndRun({
      sessionId: input.sessionId,
      run: runWithDelivery,
      userPrimaryPersisted: userPersistResult.primaryPersisted
    });
    await this.chatPostRunHooksService.run({
      session,
      run: runWithDelivery,
      requestId: input.requestId
    });
    return runWithDelivery;
  }

  private applyRejectedFallback(run: SqlRun, datasource: string): SqlRun {
    if (run.status !== "rejected") {
      return run;
    }
    if (!this.datasourceRegistry.shouldFallbackOnReject(datasource)) {
      return run;
    }
    if (run.answer) {
      return run;
    }
    return {
      ...run,
      answer:
        "请求触发了只读安全策略，本次未执行 SQL。你可以改为查询统计口径或时间范围，我会继续协助。"
    };
  }
}
