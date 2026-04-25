import { Injectable } from "@nestjs/common";
import type {
  ChatMessage,
  ContextEnvelope,
  ChatStreamEvent,
  SqlRun
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import { GraphBuilderService } from "../../agent/graph/graph.builder";
import {
  resolveAgentReasoningStage,
  resolveAgentReasoningTitle,
  resolveAgentStepLifecycle
} from "../../agent/graph/agent-step-metadata";
import { SqlToolRegistryService } from "../../agent/sql/tools/sql-tool-registry.service";
import { DatasourceRegistryService } from "../../../governance/datasource/datasource-registry.service";
import { DatasourceService } from "../../../governance/datasource/datasource.service";
import { RedisBufferService } from "../../../platform/data/cache/index";
import { ChatRepository } from "../../../platform/data/persistence/index";
import { ChatDeliveryEnrichmentService } from "./shared/chat-delivery-enrichment.service";
import {
  ChatPolicyGuardService,
  type ChatPolicyActorInput
} from "./shared/chat-policy-guard.service";
import { ChatPostRunHooksService } from "./shared/chat-post-run-hooks.service";
import { ChatRunPersistenceService } from "./shared/chat-run-persistence.service";

export interface StreamMessageInput {
  sessionId: string;
  message: string;
  requestId?: string;
  contextEnvelope?: ContextEnvelope;
  actor?: ChatPolicyActorInput;
  onEvent: (event: ChatStreamEvent) => Promise<void> | void;
}

@Injectable()
export class StreamMessageUsecase {
  constructor(
    private readonly graphBuilder: GraphBuilderService,
    private readonly sqlToolRegistry: SqlToolRegistryService,
    private readonly datasourceService: DatasourceService,
    private readonly datasourceRegistry: DatasourceRegistryService,
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly chatPolicyGuardService: ChatPolicyGuardService,
    private readonly chatDeliveryEnrichmentService: ChatDeliveryEnrichmentService,
    private readonly chatRunPersistenceService: ChatRunPersistenceService,
    private readonly chatPostRunHooksService: ChatPostRunHooksService
  ) {}

  async streamMessage(input: StreamMessageInput): Promise<SqlRun> {
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
      session,
      input.actor
    );

    const runId = uuidv4();
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

    const emit = async (type: ChatStreamEvent["type"], data: ChatStreamEvent["data"]) => {
      await input.onEvent({
        type,
        runId,
        sessionId: input.sessionId,
        at: new Date().toISOString(),
        data
      });
    };

    await emit("start", {
      requestId: input.requestId ?? null
    });

    const toolCalls: NonNullable<NonNullable<SqlRun["trace"]>["toolCalls"]> = [];
    let stepSequence = 0;

    try {
      const run = await this.graphBuilder.run(
        {
          runId,
          sessionId: input.sessionId,
          question: input.message,
          datasourceId: session.datasource,
          datasourceType: datasource.type,
          modelCatalogId: session.modelCatalogId ?? undefined,
          contextEnvelope: input.contextEnvelope,
          accessContext: sqlAccessContext,
          traceContext: {
            source: "chat",
            route: "/api/v1/sessions/:sessionId/messages/stream",
            requestId: input.requestId
          }
        },
        {
          streamMode: true,
          tools: this.sqlToolRegistry.getToolsForDatasource(datasource, {
            accessContext: sqlAccessContext
          }),
          onLlmEvent: async (event) => {
            if (event.type === "text-delta") {
              await emit("text-delta", {
                text: event.text
              });
              return;
            }

            if (event.type === "tool-call") {
              toolCalls.push({
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                status: "called",
                detail: JSON.stringify(event.input ?? {}),
                at: new Date().toISOString()
              });
              await emit("tool-call", {
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                input: event.input
              });
              return;
            }

            if (event.type === "tool-result") {
              toolCalls.push({
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                status: "result",
                detail: JSON.stringify(event.output ?? {}),
                at: new Date().toISOString()
              });
              await emit("tool-result", {
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                output: event.output
              });
              return;
            }

            toolCalls.push({
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              status: "error",
              detail: event.message,
              at: new Date().toISOString()
            });
            await emit("tool-error", {
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              message: event.message
            });
          },
          onStep: async ({ step }) => {
            const streamSequence = step.sequence ?? stepSequence + 1;
            stepSequence = Math.max(stepSequence, streamSequence);
            const stepTimestamp =
              step.at ?? step.endedAt ?? step.startedAt ?? new Date().toISOString();
            await emit("state", {
              node: step.node,
              status: step.status,
              stepId: step.stepId ?? `${runId}:${step.node}:${streamSequence}`,
              sequence: streamSequence,
              lifecycle: step.lifecycle ?? resolveAgentStepLifecycle(step.status),
              detail: step.detail ?? "",
              stage: resolveAgentReasoningStage(step.node),
              title: resolveAgentReasoningTitle(step.node),
              at: stepTimestamp,
              startedAt: step.startedAt,
              endedAt: step.endedAt,
              durationMs: step.durationMs,
              inputSummary: step.inputSummary,
              outputSummary: step.outputSummary,
              errorSummary: step.errorSummary
            });
          }
        }
      );

      const finalRun = this.applyRejectedFallback(run, session.datasource);
      finalRun.trace.streamStatus = finalRun.error ? "failed" : "completed";
      finalRun.trace.toolCalls = toolCalls;
      const runWithDelivery =
        await this.chatDeliveryEnrichmentService.attachDeliveryContract(finalRun);
      if (runWithDelivery.error) {
        await emit("error", {
          code:
            runWithDelivery.status === "rejected" ? "SQL_READONLY_REJECTED" : undefined,
          message: runWithDelivery.error,
          details: null
        });
      }
      await emit("finish", {
        status: runWithDelivery.status,
        rowCount: runWithDelivery.rows?.length ?? 0,
        delivery: runWithDelivery.delivery
      });
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
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const run: SqlRun = {
        runId,
        sessionId: input.sessionId,
        question: input.message,
        status: "failed",
        provider: session.modelProvider ?? "unknown",
        model: session.modelName ?? undefined,
        error: messageText,
        trace: {
          runId,
          provider: session.modelProvider ?? "unknown",
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
      const runWithDelivery =
        await this.chatDeliveryEnrichmentService.attachDeliveryContract(run);
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
