import { Injectable } from "@nestjs/common";
import type { ContextEnvelope, SqlRun } from "@text2sql/shared-types";
import {
  type ChatPolicyActorInput
} from "./shared/chat-policy-guard.service";
import { Text2SQLWorkflowRunner } from "../../text2sql/text2sql-workflow-runner.service";

export interface ExecuteMessageInput {
  sessionId: string;
  message: string;
  requestId?: string;
  contextEnvelope?: ContextEnvelope;
  actor?: ChatPolicyActorInput;
}

@Injectable()
export class ExecuteMessageUsecase {
  constructor(private readonly workflowRunner: Text2SQLWorkflowRunner) {}

  async executeMessage(input: ExecuteMessageInput): Promise<SqlRun> {
    return this.workflowRunner.runSync({
      sessionId: input.sessionId,
      message: input.message,
      requestId: input.requestId,
      contextEnvelope: input.contextEnvelope,
      actor: input.actor
    });
  }
}
