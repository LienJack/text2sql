import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { AdminOnlyGuard } from "../auth/admin-only.guard";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [LlmModule],
  controllers: [SettingsController],
  providers: [SettingsService, AdminOnlyGuard],
  exports: [SettingsService]
})
export class SettingsModule {}
