import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { AppConfigModule } from "../../config/config.module";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { GlossaryController } from "../../glossary/glossary.controller";
import { GlossaryService } from "../../glossary/glossary.service";

export const KNOWLEDGE_GLOSSARY_COMPAT_BRIDGE = Object.freeze({
  capability: "glossary",
  status: "active",
  lifecycle: "one-milestone",
  removeBy: "next-milestone"
});

@Module({
  imports: [AppConfigModule, PlatformDataPersistenceModule],
  controllers: [GlossaryController],
  providers: [GlossaryService, AdminOnlyGuard],
  exports: [GlossaryService]
})
export class GlossaryModule {}
