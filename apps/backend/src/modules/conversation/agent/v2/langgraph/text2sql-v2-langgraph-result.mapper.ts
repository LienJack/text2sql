import { Injectable } from "@nestjs/common";
import type {
  ExecutionTraceStep,
  SqlRun,
  Text2SqlV2RunArtifact
} from "@text2sql/shared-types";
import { DomainError } from "../../../../../common/domain-error";
import { Text2SqlV2ArtifactBuilder } from "../text2sql-v2-artifact-builder";
import type { Text2SqlV2LangGraphState } from "./text2sql-v2-langgraph.state";

export interface Text2SqlV2LangGraphProgressSummary {
  enteredStages: string[];
  enteredStageCount: number;
}

@Injectable()
export class Text2SqlV2LangGraphResultMapper {
  constructor(
    private readonly artifactBuilder: Text2SqlV2ArtifactBuilder
  ) {}

  mapSqlRun(state: Text2SqlV2LangGraphState): SqlRun {
    const legacyRun = this.requireLegacyRun(state);
    const v2Artifact = this.mapRunArtifact(state);

    return {
      ...legacyRun,
      trace: {
        ...legacyRun.trace,
        v2: v2Artifact
      }
    };
  }

  mapTraceSteps(state: Text2SqlV2LangGraphState): ExecutionTraceStep[] {
    return [...this.requireLegacyRun(state).trace.steps];
  }

  mapRunArtifact(state: Text2SqlV2LangGraphState): Text2SqlV2RunArtifact {
    const legacyRun = this.requireLegacyRun(state);
    const previousV2 = legacyRun.trace.v2;
    return this.artifactBuilder.buildRunArtifact(legacyRun, {
      stageArtifacts: previousV2?.stages,
      contextPack: previousV2?.contextPack,
      semanticPlan: previousV2?.semanticPlan,
      sqlGeneration: previousV2?.sqlGeneration,
      sqlValidation: previousV2?.sqlValidation
    });
  }

  mapProgressSummary(
    state: Text2SqlV2LangGraphState
  ): Text2SqlV2LangGraphProgressSummary {
    return {
      enteredStages: [...state.stageProgress],
      enteredStageCount: state.stageProgress.length
    };
  }

  private requireLegacyRun(state: Text2SqlV2LangGraphState): SqlRun {
    if (state.legacyRun) {
      return state.legacyRun;
    }
    throw new DomainError(
      "TEXT2SQL_V2_LANGGRAPH_RESULT_MISSING_RUN",
      "LangGraph runtime completed without a mapped SqlRun",
      500
    );
  }
}
