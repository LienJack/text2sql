import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { RagModule } from "../rag/rag.module";
import { MemoryController } from "../../memory/memory.controller";
import { MemoryPromotionPolicy } from "../../memory/memory-promotion-policy";
import { MemoryPromotionService as LegacyMemoryPromotionService } from "../../memory/memory-promotion.service";
import { MemoryPromotionService as KnowledgeMemoryPromotionService } from "./memory-promotion.service";

@Module({
  imports: [PlatformDataPersistenceModule, RagModule],
  controllers: [MemoryController],
  providers: [
    MemoryPromotionPolicy,
    LegacyMemoryPromotionService,
    {
      provide: KnowledgeMemoryPromotionService,
      useExisting: LegacyMemoryPromotionService
    },
    AdminOnlyGuard
  ],
  exports: [
    MemoryPromotionPolicy,
    LegacyMemoryPromotionService,
    KnowledgeMemoryPromotionService
  ]
})
export class MemoryModule {}
