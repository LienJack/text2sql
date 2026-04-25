import { Injectable } from "@nestjs/common";
import type { SqlRun } from "@text2sql/shared-types";
import { ChatDeliveryEnrichmentService } from "../../chat/application/shared/chat-delivery-enrichment.service";

@Injectable()
export class EnrichDeliveryStage {
  constructor(
    private readonly chatDeliveryEnrichmentService: ChatDeliveryEnrichmentService
  ) {}

  run(run: SqlRun): Promise<SqlRun> {
    return this.chatDeliveryEnrichmentService.attachDeliveryContract(run);
  }
}
