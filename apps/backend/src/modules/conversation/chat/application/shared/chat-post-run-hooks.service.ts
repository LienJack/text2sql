import { Inject, Injectable } from "@nestjs/common";
import type { Session, SqlRun } from "@text2sql/shared-types";
import {
  KNOWLEDGE_FACADE_CONTRACT,
  type KnowledgeFacadeContract
} from "../../../../knowledge/contracts/knowledge-facade.contract";
import { TraceService } from "../../../../observability/trace.service";

export interface ChatPostRunHooksInput {
  session: Session;
  run: SqlRun;
  requestId?: string;
}

@Injectable()
export class ChatPostRunHooksService {
  constructor(
    private readonly traceService: TraceService,
    @Inject(KNOWLEDGE_FACADE_CONTRACT)
    private readonly knowledgeFacade: KnowledgeFacadeContract
  ) {}

  async run(input: ChatPostRunHooksInput): Promise<void> {
    this.traceService.record(input.run.trace, {
      status: input.run.status,
      error: input.run.error
    });
    try {
      await this.knowledgeFacade.memory.promotion.promoteFromRun({
        run: input.run,
        datasourceId: input.session.datasource,
        requestId: input.requestId
      });
    } catch {
      // memory promotion is additive and must not interrupt chat completion.
    }
  }
}
