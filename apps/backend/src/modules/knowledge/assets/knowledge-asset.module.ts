import { Module } from "@nestjs/common";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { SKILL_REGISTRY_BINDING_SOURCE } from "../../skill-registry/skill-registry.service";
import { KNOWLEDGE_ASSET_CONTRACT } from "../contracts/knowledge-asset.contract";
import { KnowledgeAssetFacade } from "./knowledge-asset.facade";
import { KnowledgeAssetService } from "./knowledge-asset.service";
import { KnowledgePromotionPolicy } from "./knowledge-promotion-policy";
import { KnowledgeSkillBindingSource } from "./knowledge-skill-binding-source.service";

@Module({
  imports: [PlatformDataPersistenceModule],
  providers: [
    KnowledgePromotionPolicy,
    KnowledgeAssetService,
    KnowledgeAssetFacade,
    KnowledgeSkillBindingSource,
    {
      provide: KNOWLEDGE_ASSET_CONTRACT,
      useExisting: KnowledgeAssetFacade
    },
    {
      provide: SKILL_REGISTRY_BINDING_SOURCE,
      useExisting: KnowledgeSkillBindingSource
    }
  ],
  exports: [
    KnowledgePromotionPolicy,
    KnowledgeAssetService,
    KnowledgeAssetFacade,
    KNOWLEDGE_ASSET_CONTRACT,
    SKILL_REGISTRY_BINDING_SOURCE
  ]
})
export class KnowledgeAssetModule {}
