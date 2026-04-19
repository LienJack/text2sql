import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../auth/admin-only.guard";
import { AppConfigModule } from "../config/config.module";
import { PlatformDataModule } from "../platform/data/data.module";
import { GlossaryController } from "./glossary.controller";
import { GlossaryService } from "./glossary.service";

@Module({
  imports: [AppConfigModule, PlatformDataModule],
  controllers: [GlossaryController],
  providers: [GlossaryService, AdminOnlyGuard],
  exports: [GlossaryService]
})
export class GlossaryModule {}
