import { Injectable } from "@nestjs/common";
import type { SqlRun } from "@text2sql/shared-types";
import { ChatRunPersistenceService } from "../../chat/application/shared/chat-run-persistence.service";

export interface PersistRunStageInput {
  sessionId: string;
  run: SqlRun;
  userPrimaryPersisted: boolean;
}

@Injectable()
export class PersistRunStage {
  constructor(
    private readonly chatRunPersistenceService: ChatRunPersistenceService
  ) {}

  run(input: PersistRunStageInput): Promise<void> {
    return this.chatRunPersistenceService.persistAssistantAndRun(input);
  }
}
