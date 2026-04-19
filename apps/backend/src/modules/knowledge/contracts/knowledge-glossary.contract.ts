import type { GlossaryService } from "../../glossary/glossary.service";

export const KNOWLEDGE_GLOSSARY_CONTRACT = Symbol("KNOWLEDGE_GLOSSARY_CONTRACT");

export interface KnowledgeGlossaryContract {
  terms: Pick<
    GlossaryService,
    | "listTerms"
    | "createTerm"
    | "updateTerm"
    | "toggleTerm"
    | "listAnchors"
    | "createAnchor"
    | "rollbackAnchor"
  >;
}
