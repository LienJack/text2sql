import { Injectable } from "@nestjs/common";
import type { Session, SqlRun } from "@text2sql/shared-types";
import { ChatPostRunHooksService } from "../../chat/application/shared/chat-post-run-hooks.service";

export interface PostRunHooksStageInput {
  session: Session;
  run: SqlRun;
  requestId?: string;
}

@Injectable()
export class PostRunHooksStage {
  constructor(
    private readonly chatPostRunHooksService: ChatPostRunHooksService
  ) {}

  run(input: PostRunHooksStageInput): Promise<void> {
    return this.chatPostRunHooksService.run(input);
  }
}
