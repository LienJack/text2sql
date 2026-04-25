import { Injectable } from "@nestjs/common";
import type {
  ChatStreamEvent,
  ChatStreamEventData,
  ChatStreamEventType,
  ExecutionTraceStep,
  SqlRun
} from "@text2sql/shared-types";
import type { LlmGatewayStreamEvent } from "../../../llm/llm-gateway.interface";
import {
  resolveText2SqlReasoningStage,
  resolveText2SqlTitle
} from "../stages/text2sql-stage-catalog";

interface StepEventInput {
  step: ExecutionTraceStep;
  runId: string;
  lastSequence: number;
}

interface StepEventOutput {
  data: ChatStreamEventData;
  nextSequence: number;
}

interface LlmEventOutput {
  type: ChatStreamEventType;
  data: ChatStreamEventData;
  traceToolCall?: NonNullable<NonNullable<SqlRun["trace"]>["toolCalls"]>[number];
}

@Injectable()
export class Text2SqlStreamEventMapper {
  createEnvelope(input: {
    type: ChatStreamEventType;
    data: ChatStreamEventData;
    runId: string;
    sessionId: string;
    at?: string;
  }): ChatStreamEvent {
    return {
      type: input.type,
      runId: input.runId,
      sessionId: input.sessionId,
      at: input.at ?? new Date().toISOString(),
      data: input.data
    };
  }

  mapLlmEvent(event: LlmGatewayStreamEvent): LlmEventOutput {
    if (event.type === "text-delta") {
      return {
        type: "text-delta",
        data: {
          text: event.text
        }
      };
    }

    if (event.type === "tool-call") {
      return {
        type: "tool-call",
        data: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input: event.input
        },
        traceToolCall: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          status: "called",
          detail: JSON.stringify(event.input ?? {}),
          at: new Date().toISOString()
        }
      };
    }

    if (event.type === "tool-result") {
      return {
        type: "tool-result",
        data: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          output: event.output
        },
        traceToolCall: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          status: "result",
          detail: JSON.stringify(event.output ?? {}),
          at: new Date().toISOString()
        }
      };
    }

    return {
      type: "tool-error",
      data: {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        message: event.message
      },
      traceToolCall: {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        status: "error",
        detail: event.message,
        at: new Date().toISOString()
      }
    };
  }

  mapStepEvent(input: StepEventInput): StepEventOutput {
    const sequence = input.step.sequence ?? input.lastSequence + 1;
    const stepAt =
      input.step.at ?? input.step.endedAt ?? input.step.startedAt ?? new Date().toISOString();

    return {
      data: {
        node: input.step.node,
        status: input.step.status,
        stepId: input.step.stepId ?? `${input.runId}:${input.step.node}:${sequence}`,
        sequence,
        lifecycle: input.step.lifecycle ?? this.resolveLifecycle(input.step.status),
        detail: input.step.detail ?? "",
        stage: resolveText2SqlReasoningStage(input.step.node),
        title: resolveText2SqlTitle(input.step.node),
        at: stepAt,
        startedAt: input.step.startedAt,
        endedAt: input.step.endedAt,
        durationMs: input.step.durationMs,
        inputSummary: input.step.inputSummary,
        outputSummary: input.step.outputSummary,
        errorSummary: input.step.errorSummary
      },
      nextSequence: Math.max(input.lastSequence, sequence)
    };
  }

  private resolveLifecycle(
    status: ExecutionTraceStep["status"]
  ): "completed" | "failed" | "skipped" {
    if (status === "failed") {
      return "failed";
    }
    if (status === "skipped") {
      return "skipped";
    }
    return "completed";
  }
}
