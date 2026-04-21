import type { MemoryPromotionService } from "../memory/memory-promotion.service";

export const KNOWLEDGE_MEMORY_CONTRACT = Symbol("KNOWLEDGE_MEMORY_CONTRACT");

export interface KnowledgeMemoryContract {
  promotion: Pick<
    MemoryPromotionService,
    | "promoteFromRun"
    | "getRecord"
    | "listCompensations"
    | "buildCandidateIdForRun"
    | "applyFeedback"
  >;
}
