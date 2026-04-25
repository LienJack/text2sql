import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { RagModule } from "../rag/rag.module";
import { MemoryController } from "../../memory/memory.controller";
import { MemoryPromotionPolicy } from "../../memory/memory-promotion-policy";
import { MemoryPromotionService as LegacyMemoryPromotionService } from "../../memory/memory-promotion.service";
import { MemoryPromotionService as KnowledgeMemoryPromotionService } from "./memory-promotion.service";
import { SavedPriorSqlService } from "./saved-prior-sql.service";

export const KNOWLEDGE_MEMORY_COMPAT_BRIDGE = Object.freeze({
  capability: "memory",
  status: "active",
  lifecycle: "one-milestone",
  removeBy: "next-milestone"
});

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
    SavedPriorSqlService,
    AdminOnlyGuard
  ],
  exports: [
    MemoryPromotionPolicy,
    LegacyMemoryPromotionService,
    KnowledgeMemoryPromotionService,
    SavedPriorSqlService
  ]
})
export class MemoryModule {}
