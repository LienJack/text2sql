import type {
  SemanticContextPackV1,
  SemanticPlanV1,
  SqlGenerationArtifactV1,
  SqlValidationArtifactV1,
  Text2SqlV2RunArtifact,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName
} from "@text2sql/shared-types";

export const TEXT2SQL_V2_STAGE_ORDER: Text2SqlV2StageName[] = [
  "intake",
  "retrieve",
  "assemble-context",
  "semantic-plan",
  "generate-sql",
  "validate",
  "correct",
  "execute",
  "answer"
];

export interface Text2SqlV2RunContext {
  runId: string;
  sessionId: string;
  question: string;
}

export interface Text2SqlV2StateMachineResult {
  stages: Text2SqlV2StageArtifact[];
  contextPack?: SemanticContextPackV1;
  semanticPlan?: SemanticPlanV1;
  sqlGeneration?: SqlGenerationArtifactV1;
  sqlValidation?: SqlValidationArtifactV1;
}

export type Text2SqlV2MutableRunArtifact = Omit<Text2SqlV2RunArtifact, "version"> & {
  version: "v2";
};
