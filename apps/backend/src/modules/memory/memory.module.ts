import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../auth/admin-only.guard";
import { DataModule } from "../data/data.module";
import { RagModule } from "../rag/rag.module";
import { MemoryController } from "./memory.controller";
import { MemoryPromotionPolicy } from "./memory-promotion-policy";
import { MemoryPromotionService } from "./memory-promotion.service";

@Module({
  imports: [DataModule, RagModule],
  controllers: [MemoryController],
  providers: [MemoryPromotionPolicy, MemoryPromotionService, AdminOnlyGuard],
  exports: [MemoryPromotionPolicy, MemoryPromotionService]
})
export class MemoryModule {}
