import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { SemanticRegistryService as LegacySemanticRegistryService } from "../../semantic-registry/semantic-registry.service";
import { SemanticRegistryService as KnowledgeSemanticRegistryService } from "./semantic-registry.service";

@Module({
  imports: [AppConfigModule],
  providers: [
    LegacySemanticRegistryService,
    {
      provide: KnowledgeSemanticRegistryService,
      useExisting: LegacySemanticRegistryService
    }
  ],
  exports: [LegacySemanticRegistryService, KnowledgeSemanticRegistryService]
})
export class SemanticRegistryModule {}
