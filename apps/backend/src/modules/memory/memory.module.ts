import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../auth/admin-only.guard";
import { PlatformDataModule } from "../platform/data/data.module";
import { RagModule } from "../knowledge/rag/rag.module";
import { MemoryController } from "./memory.controller";
import { MemoryPromotionPolicy } from "./memory-promotion-policy";
import { MemoryPromotionService } from "./memory-promotion.service";

@Module({
  imports: [PlatformDataModule, RagModule],
  controllers: [MemoryController],
  providers: [MemoryPromotionPolicy, MemoryPromotionService, AdminOnlyGuard],
  exports: [MemoryPromotionPolicy, MemoryPromotionService]
})
export class MemoryModule {}
