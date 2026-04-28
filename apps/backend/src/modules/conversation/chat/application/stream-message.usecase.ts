import { Injectable } from "@nestjs/common";
import type {
  ContextEnvelope,
  ChatStreamEvent,
  SqlRun
} from "@text2sql/shared-types";
import {
  type ChatPolicyActorInput
} from "./shared/chat-policy-guard.service";
import { Text2SQLWorkflowRunner } from "../../application/workflow/text2sql-workflow-runner.service";

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
  constructor(private readonly workflowRunner: Text2SQLWorkflowRunner) {}

  async streamMessage(input: StreamMessageInput): Promise<SqlRun> {
    return this.workflowRunner.runStream({
      sessionId: input.sessionId,
      message: input.message,
      requestId: input.requestId,
      onEvent: input.onEvent,
      contextEnvelope: input.contextEnvelope,
      actor: input.actor
    });
  }
}
