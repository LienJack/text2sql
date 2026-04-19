import { Injectable } from "@nestjs/common";
import type { Session, SqlRun } from "@text2sql/shared-types";
import { MemoryPromotionService } from "../../../../knowledge/memory/memory-promotion.service";
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
    private readonly memoryPromotionService: MemoryPromotionService
  ) {}

  async run(input: ChatPostRunHooksInput): Promise<void> {
    this.traceService.record(input.run.trace, {
      status: input.run.status,
      error: input.run.error
    });
    try {
      await this.memoryPromotionService.promoteFromRun({
        run: input.run,
        datasourceId: input.session.datasource,
        requestId: input.requestId
      });
    } catch {
      // memory promotion is additive and must not interrupt chat completion.
    }
  }
}
