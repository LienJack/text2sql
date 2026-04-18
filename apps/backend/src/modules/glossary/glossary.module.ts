import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../auth/admin-only.guard";
import { AppConfigModule } from "../config/config.module";
import { DataModule } from "../data/data.module";
import { GlossaryController } from "./glossary.controller";
import { GlossaryService } from "./glossary.service";

@Module({
  imports: [AppConfigModule, DataModule],
  controllers: [GlossaryController],
  providers: [GlossaryService, AdminOnlyGuard],
  exports: [GlossaryService]
})
export class GlossaryModule {}
