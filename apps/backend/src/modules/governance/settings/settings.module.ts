import { Module } from "@nestjs/common";
import { LlmModule } from "../../llm/llm.module";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { PromptTemplateService } from "./prompt-template.service";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [LlmModule],
  controllers: [SettingsController],
  providers: [SettingsService, PromptTemplateService, AdminOnlyGuard],
  exports: [SettingsService, PromptTemplateService]
})
export class SettingsModule {}
