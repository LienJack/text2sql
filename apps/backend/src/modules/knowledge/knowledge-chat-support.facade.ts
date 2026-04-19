import { Injectable } from "@nestjs/common";
import { MemoryPromotionService } from "./memory/memory-promotion.service";
import { RagReplayRepository } from "./rag/observability/rag-replay.repository";

@Injectable()
export class KnowledgeChatSupportFacade {
  constructor(
    readonly memoryPromotionService: MemoryPromotionService,
    readonly ragReplayRepository: RagReplayRepository
  ) {}
}
