import { Injectable } from "@nestjs/common";
import type {
  ExecutionTraceStep,
  SqlRun,
  Text2SqlV2RunArtifact,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName
} from "@text2sql/shared-types";
import { DomainError } from "../../../../../common/domain-error";
import { Text2SqlV2ArtifactBuilder } from "../../../artifacts/text2sql-v2/text2sql-v2-artifact-builder";
import { TEXT2SQL_V2_STAGE_ORDER } from "../../../contracts/text2sql-v2.types";
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
    if (!state.answerResult && !state.failure) {
      throw new DomainError(
        "TEXT2SQL_V2_LANGGRAPH_RESULT_MISSING_ANSWER",
        "LangGraph runtime completed without answer or terminal failure",
        500
      );
    }

    const status =
      state.answerResult?.status ??
      (state.failure?.category === "execution" ? "failed" : "rejected");
    const provider = state.sqlDraft?.provider ?? state.preparedRun.session.modelProvider ?? "unknown";
    const model = state.sqlDraft?.model ?? state.preparedRun.session.modelName ?? undefined;
    const traceSteps = this.mapTraceSteps(state);
    const answer =
      state.answerResult?.answer ??
      state.failure?.message ??
      "系统未返回结果。";
    const run: SqlRun = {
      runId: state.runId,
      sessionId: state.sessionId,
      question: state.question,
      status,
      provider,
      model,
      sql: state.sqlGenerationArtifact?.sql,
      explanation: state.sqlDraft?.explanation,
      answer,
      rows: state.executionResult?.rows,
      columns: state.executionResult?.columns,
      ...(status === "failed" || status === "rejected"
        ? {
            error:
              state.failure?.message ??
              (status === "failed"
                ? "Text2SQL execution failed"
                : "Text2SQL request rejected")
          }
        : {}),
      ...(state.answerResult?.mode === "clarification" && state.clarification
        ? { clarification: state.clarification }
        : {}),
      trace: {
        runId: state.runId,
        provider,
        retryCount: state.correctionAttemptCount,
        steps: traceSteps,
        ...(state.sqlDraft?.promptTemplate
          ? {
              promptTemplate: state.sqlDraft.promptTemplate
            }
          : {}),
        ...(state.loopEvidence.length > 0
          ? {
              loopEvidence: state.loopEvidence
            }
          : {}),
        ...(state.terminationReason
          ? {
              terminationReason: state.terminationReason
            }
          : {})
      },
      llmRaw: null,
      createdAt: state.completedAt ?? state.createdAt
    };
    const v2Artifact = this.mapRunArtifact(state, run);

    return {
      ...run,
      trace: {
        ...run.trace,
        v2: v2Artifact
      }
    };
  }

  mapTraceSteps(state: Text2SqlV2LangGraphState): ExecutionTraceStep[] {
    const rawSteps =
      state.traceSteps.length > 0
        ? state.traceSteps
        : this.buildFallbackTraceSteps(state.stageArtifacts);

    return rawSteps.map((step, index) => ({
      ...step,
      sequence: step.sequence ?? index + 1,
      stepId: step.stepId ?? `${state.runId}:${step.node}:${index + 1}`,
      lifecycle:
        step.lifecycle ??
        (step.status === "failed"
          ? "failed"
          : step.status === "skipped"
            ? "skipped"
            : "completed")
    }));
  }

  mapRunArtifact(
    state: Text2SqlV2LangGraphState,
    baseRun?: SqlRun
  ): Text2SqlV2RunArtifact {
    const run =
      baseRun ??
      ({
        runId: state.runId,
        sessionId: state.sessionId,
        question: state.question,
        status: "executionResult",
        provider:
          state.sqlDraft?.provider ??
          state.preparedRun.session.modelProvider ??
          "unknown",
        model: state.sqlDraft?.model ?? state.preparedRun.session.modelName,
        trace: {
          runId: state.runId,
          provider:
            state.sqlDraft?.provider ??
            state.preparedRun.session.modelProvider ??
            "unknown",
          retryCount: state.correctionAttemptCount,
          steps: this.mapTraceSteps(state),
          ...(state.loopEvidence.length > 0
            ? {
                loopEvidence: state.loopEvidence
              }
            : {}),
          ...(state.terminationReason
            ? {
                terminationReason: state.terminationReason
              }
            : {})
        },
        llmRaw: null,
        createdAt: state.completedAt ?? state.createdAt
      } as SqlRun);

    return this.artifactBuilder.buildRunArtifact(run, {
      stageArtifacts: this.resolveStageArtifacts(state.stageArtifacts),
      contextPack: state.contextPack,
      semanticPlan: state.semanticPlan,
      sqlGeneration: state.sqlGenerationArtifact,
      sqlValidation: state.sqlValidationArtifact
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

  private resolveStageArtifacts(
    artifacts: Text2SqlV2StageArtifact[]
  ): Text2SqlV2StageArtifact[] {
    const byStage = new Map<Text2SqlV2StageName, Text2SqlV2StageArtifact>();
    for (const artifact of artifacts) {
      if (!this.isStageName(artifact.stage)) {
        continue;
      }
      byStage.set(artifact.stage, artifact);
    }
    return TEXT2SQL_V2_STAGE_ORDER.map((stage) => {
      return byStage.get(stage) ?? { stage, status: "skipped" };
    });
  }

  private buildFallbackTraceSteps(
    artifacts: Text2SqlV2StageArtifact[]
  ): ExecutionTraceStep[] {
    return this.resolveStageArtifacts(artifacts).map((artifact, index) => {
      const at =
        artifact.endedAt ??
        artifact.startedAt ??
        new Date().toISOString();
      return {
        node: artifact.stage,
        status:
          artifact.status === "failed"
            ? "failed"
            : artifact.status === "skipped"
              ? "skipped"
              : "success",
        at,
        detail: `stage ${artifact.stage} ${artifact.status}`,
        outputSummary: JSON.stringify({
          v2: {
            stageArtifact: artifact
          }
        }),
        sequence: index + 1,
        stepId: `${artifact.stage}:${index + 1}`,
        lifecycle:
          artifact.status === "failed"
            ? "failed"
            : artifact.status === "skipped"
              ? "skipped"
              : "completed"
      };
    });
  }

  private isStageName(value: string): value is Text2SqlV2StageName {
    return (TEXT2SQL_V2_STAGE_ORDER as readonly string[]).includes(value);
  }
}
