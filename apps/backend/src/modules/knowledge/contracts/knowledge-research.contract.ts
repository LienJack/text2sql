import type {
  ResearchRunResult,
  ResearchTimeBoundary
} from "../research/contracts/research.types";

export const KNOWLEDGE_RESEARCH_CONTRACT = Symbol(
  "KNOWLEDGE_RESEARCH_CONTRACT"
);

export interface KnowledgeResearchContract {
  run(input: {
    actor: Express.RequestActor;
    taskId: string;
    revisionId: string;
    workspaceId: string;
    question: string;
    decisionUse: string;
    timeBoundary?: ResearchTimeBoundary;
    stopConditions: string[];
    budget: {
      maxSearchCount: number;
      maxArtifactBytes: number;
    };
  }): Promise<ResearchRunResult>;
}
