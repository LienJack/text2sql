import type { SemanticRegistryService } from "../semantic-registry/semantic-registry.service";
import type { SemanticSpineCompilerService } from "../semantic-spine/semantic-spine-compiler.service";
import type { SemanticSpineContextPackMapper } from "../semantic-spine/semantic-spine-context-pack.mapper";
import type { SemanticSpineRepository } from "../semantic-spine/semantic-spine.repository";

export const KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT = Symbol(
  "KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT"
);

export const KNOWLEDGE_SEMANTIC_SPINE_COMPILER_CONTRACT = Symbol(
  "KNOWLEDGE_SEMANTIC_SPINE_COMPILER_CONTRACT"
);

export const KNOWLEDGE_SEMANTIC_SPINE_CONTEXT_PACK_MAPPER_CONTRACT = Symbol(
  "KNOWLEDGE_SEMANTIC_SPINE_CONTEXT_PACK_MAPPER_CONTRACT"
);

export interface KnowledgeSemanticSpineCompilerContract
  extends Pick<SemanticSpineCompilerService, "compile"> {}

export interface KnowledgeSemanticSpineContextPackMapperContract
  extends Pick<SemanticSpineContextPackMapper, "mapToContextPack"> {}

export interface KnowledgeSemanticSpineContract {
  repository: Pick<
    SemanticSpineRepository,
    | "buildDatasourceScopedDomain"
    | "publishSnapshot"
    | "resolveSnapshot"
    | "getSnapshot"
    | "listSnapshots"
  >;
  compiler?: KnowledgeSemanticSpineCompilerContract;
  mapper?: KnowledgeSemanticSpineContextPackMapperContract;
}

export interface KnowledgeSemanticRegistryContract {
  registry: Pick<
    SemanticRegistryService,
    | "buildDatasourceScopedDomain"
    | "publishVersion"
    | "resolveTerm"
    | "publishGlossaryAnchorSemantic"
  >;
  semanticSpine?: KnowledgeSemanticSpineContract;
}
