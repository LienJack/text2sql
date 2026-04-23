import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import {
  KNOWLEDGE_SEMANTIC_SPINE_COMPILER_CONTRACT,
  KNOWLEDGE_SEMANTIC_SPINE_CONTEXT_PACK_MAPPER_CONTRACT
} from "../contracts/knowledge-semantic-registry.contract";
import { SemanticSpineCompilerService } from "./semantic-spine-compiler.service";
import { SemanticSpineContextPackMapper } from "./semantic-spine-context-pack.mapper";
import { RelationshipImpactSimulatorService } from "./relationship-impact-simulator.service";
import { RelationshipVersioningService } from "./relationship-versioning.service";
import { SemanticSpineShadowService } from "./semantic-spine-shadow.service";
import { SemanticSpineRepository } from "./semantic-spine.repository";

export const KNOWLEDGE_SEMANTIC_SPINE_COMPAT_BRIDGE = Object.freeze({
  capability: "semantic-spine",
  status: "active",
  lifecycle: "one-milestone",
  removeBy: "next-milestone"
});

@Module({
  imports: [AppConfigModule],
  providers: [
    SemanticSpineRepository,
    SemanticSpineCompilerService,
    SemanticSpineContextPackMapper,
    RelationshipVersioningService,
    RelationshipImpactSimulatorService,
    SemanticSpineShadowService,
    {
      provide: KNOWLEDGE_SEMANTIC_SPINE_COMPILER_CONTRACT,
      useExisting: SemanticSpineCompilerService
    },
    {
      provide: KNOWLEDGE_SEMANTIC_SPINE_CONTEXT_PACK_MAPPER_CONTRACT,
      useExisting: SemanticSpineContextPackMapper
    }
  ],
  exports: [
    SemanticSpineRepository,
    SemanticSpineCompilerService,
    SemanticSpineContextPackMapper,
    RelationshipVersioningService,
    RelationshipImpactSimulatorService,
    SemanticSpineShadowService,
    KNOWLEDGE_SEMANTIC_SPINE_COMPILER_CONTRACT,
    KNOWLEDGE_SEMANTIC_SPINE_CONTEXT_PACK_MAPPER_CONTRACT
  ]
})
export class SemanticSpineModule {}
