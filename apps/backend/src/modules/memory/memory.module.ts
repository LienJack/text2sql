import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../auth/admin-only.guard";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { RagModule } from "../knowledge/rag/rag.module";
import { MemoryController } from "./memory.controller";
import { MemoryPromotionPolicy } from "./memory-promotion-policy";
import { MemoryPromotionService } from "./memory-promotion.service";

@Module({
  imports: [PlatformDataPersistenceModule, RagModule],
  controllers: [MemoryController],
  providers: [MemoryPromotionPolicy, MemoryPromotionService, AdminOnlyGuard],
  exports: [MemoryPromotionPolicy, MemoryPromotionService]
})
export class MemoryModule {}
