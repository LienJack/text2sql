import { Injectable } from "@nestjs/common";
import { createChatStreamEventEnvelope } from "@text2sql/chat-stream-protocol";
import type {
  ChatStreamEvent,
  ContextEnvelope,
  SqlRun
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { DatasourceRegistryService } from "../../../governance/datasource/datasource-registry.service";
import type { ChatPolicyActorInput } from "../../chat/application/shared/chat-policy-guard.service";
import { Text2SqlStreamEventMapper } from "../../text2sql/stream/text2sql-stream-event.mapper";
import { EnrichDeliveryStage } from "../../text2sql/stages/enrich-delivery.stage";
import { PersistRunStage } from "../../text2sql/stages/persist-run.stage";
import { PostRunHooksStage } from "../../text2sql/stages/post-run-hooks.stage";
import { PrepareRunStage } from "../../text2sql/stages/prepare-run.stage";
import { RunV2LangGraphStage } from "../../runtime/stages/run-v2-langgraph.stage";

export interface Text2SqlWorkflowInput {
  sessionId: string;
  message: string;
  requestId?: string;
  contextEnvelope?: ContextEnvelope;
  actor?: ChatPolicyActorInput;
}

export interface Text2SqlStreamWorkflowInput extends Text2SqlWorkflowInput {
  onEvent: (event: ChatStreamEvent) => Promise<void> | void;
}

@Injectable()
export class Text2SQLWorkflowRunner {
  private readonly syncRoute = "/api/v1/sessions/:sessionId/messages";
  private readonly streamRoute = "/api/v1/sessions/:sessionId/messages/stream";

  constructor(
    private readonly datasourceRegistry: DatasourceRegistryService,
    private readonly prepareRunStage: PrepareRunStage,
    private readonly runV2LangGraphStage: RunV2LangGraphStage,
    private readonly enrichDeliveryStage: EnrichDeliveryStage,
    private readonly persistRunStage: PersistRunStage,
    private readonly postRunHooksStage: PostRunHooksStage,
    private readonly streamEventMapper: Text2SqlStreamEventMapper
  ) {}

  async runSync(input: Text2SqlWorkflowInput): Promise<SqlRun> {
    const prepared = await this.prepareRunStage.run(input);
    const run = await this.runV2LangGraphStage.runSync(prepared, this.syncRoute);
    return this.finalizeSuccessRun(prepared, run);
  }

  async runStream(input: Text2SqlStreamWorkflowInput): Promise<SqlRun> {
    const prepared = await this.prepareRunStage.run(input);

    const emit = async (type: ChatStreamEvent["type"], data: ChatStreamEvent["data"]) => {
      await input.onEvent(
        createChatStreamEventEnvelope({
          type,
          data,
          runId: prepared.runId,
          sessionId: prepared.session.id
        })
      );
    };

    await emit("start", {
      requestId: prepared.requestId ?? null
    });

    const toolCalls: NonNullable<NonNullable<SqlRun["trace"]>["toolCalls"]> = [];
    let stepSequence = 0;

    try {
      const run = await this.runV2LangGraphStage.runStream(prepared, this.streamRoute, {
        onLlmEvent: async (event) => {
          const mappedEvent = this.streamEventMapper.mapLlmEvent(event);
          if (mappedEvent.traceToolCall) {
            toolCalls.push(mappedEvent.traceToolCall);
          }
          await emit(mappedEvent.type, mappedEvent.data);
        },
        onStep: async ({ step }) => {
          const mappedEvent = this.streamEventMapper.mapStepEvent({
            step,
            runId: prepared.runId,
            lastSequence: stepSequence
          });
          stepSequence = mappedEvent.nextSequence;
          await emit("state", mappedEvent.data);
        }
      });

      const finalizedRun = this.applyRejectedFallback(run, prepared.session.datasource);
      finalizedRun.trace.streamStatus = finalizedRun.error ? "failed" : "completed";
      finalizedRun.trace.toolCalls = toolCalls;

      const runWithDelivery = await this.enrichDeliveryStage.run(finalizedRun);
      if (runWithDelivery.error) {
        await emit("error", {
          code:
            runWithDelivery.status === "rejected"
              ? "SQL_READONLY_REJECTED"
              : undefined,
          message: runWithDelivery.error,
          details: null
        });
      }

      await emit("finish", {
        status: runWithDelivery.status,
        rowCount: runWithDelivery.rows?.length ?? 0,
        delivery: runWithDelivery.delivery
      });

      await this.persistRunStage.run({
        sessionId: prepared.session.id,
        run: runWithDelivery,
        userPrimaryPersisted: prepared.userPersistResult.primaryPersisted
      });
      await this.postRunHooksStage.run({
        session: prepared.session,
        run: runWithDelivery,
        requestId: prepared.requestId
      });
      return runWithDelivery;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const run: SqlRun = {
        runId: prepared.runId,
        sessionId: prepared.session.id,
        question: prepared.question,
        status: "failed",
        provider: prepared.session.modelProvider ?? "unknown",
        model: prepared.session.modelName ?? undefined,
        error: messageText,
        trace: {
          runId: prepared.runId,
          provider: prepared.session.modelProvider ?? "unknown",
          retryCount: 0,
          steps: [],
          streamStatus: "failed",
          toolCalls
        },
        llmRaw: null,
        createdAt: new Date().toISOString()
      };

      const domainError = error instanceof DomainError ? error : undefined;
      await emit("error", {
        code: domainError?.code,
        message: messageText,
        details: (domainError?.details as Record<string, unknown> | undefined) ?? null
      });

      const runWithDelivery = await this.enrichDeliveryStage.run(run);
      await this.persistRunStage.run({
        sessionId: prepared.session.id,
        run: runWithDelivery,
        userPrimaryPersisted: prepared.userPersistResult.primaryPersisted
      });
      await this.postRunHooksStage.run({
        session: prepared.session,
        run: runWithDelivery,
        requestId: prepared.requestId
      });
      return runWithDelivery;
    }
  }

  private async finalizeSuccessRun(
    prepared: Awaited<ReturnType<PrepareRunStage["run"]>>,
    run: SqlRun
  ): Promise<SqlRun> {
    const finalRun = this.applyRejectedFallback(run, prepared.session.datasource);
    const runWithDelivery = await this.enrichDeliveryStage.run(finalRun);

    await this.persistRunStage.run({
      sessionId: prepared.session.id,
      run: runWithDelivery,
      userPrimaryPersisted: prepared.userPersistResult.primaryPersisted
    });
    await this.postRunHooksStage.run({
      session: prepared.session,
      run: runWithDelivery,
      requestId: prepared.requestId
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
