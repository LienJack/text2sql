import type { SemanticRegistryService } from "../semantic-registry/semantic-registry.service";

export const KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT = Symbol(
  "KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT"
);

export interface KnowledgeSemanticRegistryContract {
  registry: Pick<
    SemanticRegistryService,
    | "buildDatasourceScopedDomain"
    | "publishVersion"
    | "resolveTerm"
    | "publishGlossaryAnchorSemantic"
  >;
}
