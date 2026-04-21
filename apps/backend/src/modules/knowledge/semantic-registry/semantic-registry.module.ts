import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { SemanticRegistryService as LegacySemanticRegistryService } from "../../semantic-registry/semantic-registry.service";
import { SemanticRegistryService as KnowledgeSemanticRegistryService } from "./semantic-registry.service";

export const KNOWLEDGE_SEMANTIC_REGISTRY_COMPAT_BRIDGE = Object.freeze({
  capability: "semantic-registry",
  status: "active",
  lifecycle: "one-milestone",
  removeBy: "next-milestone"
});

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
