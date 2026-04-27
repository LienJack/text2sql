import { Injectable } from "@nestjs/common";
import type {
  ClarificationDecisionEvidence,
  ClarificationPrompt,
  ContextEnvelope,
  ExecutionTrace,
  ExecutionTraceStep,
  SemanticPlanV1,
  SqlRun,
  Text2SqlV2LoopEvidence,
  Text2SqlV2TerminationReason,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import type { LlmGatewayStreamEvent } from "../../../llm/llm-gateway.interface";
import {
  ProviderRouterService,
  type Text2SqlStageTaskProfilePolicy
} from "../../../llm/provider-router.service";
import type { SqlTableAccessContext } from "../../../platform/data/query/index";
import { BuildIntentPlanNode, type IntentPlan } from "../nodes/build-intent-plan.node";
import {
  BuildPhysicalPlanNode,
  type PhysicalPlan
} from "../nodes/build-physical-plan.node";
import {
  BuildSemanticQueryNode,
  type SemanticQueryPlan
} from "../nodes/build-semantic-query.node";
import { ClarifyNode } from "../nodes/clarify.node";
import { ExecuteSqlNode } from "../nodes/execute-sql.node";
import { FormatAnswerNode } from "../nodes/format-answer.node";
import { GenerateSqlNode } from "../nodes/generate-sql.node";
import {
  ResolveSavedPriorSqlNode,
  type SavedPriorSqlResolution
} from "../nodes/resolve-saved-prior-sql.node";
import {
  RetrieveKnowledgeNode,
  type RetrievedKnowledge
} from "../nodes/retrieve-knowledge.node";
import { SafetyCheckNode } from "../nodes/safety-check.node";
import { SqlToolRegistryService } from "../sql/tools/sql-tool-registry.service";
import type { Text2SqlPreparedRunContext } from "../../text2sql/stages/prepare-run.stage";
import { LangsmithTraceService } from "../../../observability/langsmith-trace.service";
import { SqlCorrectionService } from "./sql-correction.service";
import {
  createText2SqlV2StageLifecycle,
  toText2SqlV2FailureSemantic
} from "./text2sql-v2-artifacts";
import { Text2SqlV2StateMachine } from "./text2sql-v2-state-machine";

export interface Text2SqlV2StreamOptions {
  onLlmEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
  onStep?: (event: {
    step: NonNullable<SqlRun["trace"]>["steps"][number];
  }) => Promise<void> | void;
}

interface ExecutionContextEvidence {
  effectiveContextSummary?: NonNullable<SqlRun["trace"]>["effectiveContextSummary"];
  conflictHint?: NonNullable<SqlRun["trace"]>["conflictHint"];
}

type ClarifyDecisionRaw = ReturnType<ClarifyNode["evaluate"]>;

type RunRouteSource = "chat" | "evaluation";

const CONTEXT_CONFLICT_REGEX = /conflict|mismatch|contradict|inconsistent|冲突/i;

@Injectable()
export class Text2SqlV2RunnerService {
  constructor(
    private readonly clarifyNode: ClarifyNode,
    private readonly retrieveKnowledgeNode: RetrieveKnowledgeNode,
    private readonly buildIntentPlanNode: BuildIntentPlanNode,
    private readonly buildSemanticQueryNode: BuildSemanticQueryNode,
    private readonly buildPhysicalPlanNode: BuildPhysicalPlanNode,
    private readonly resolveSavedPriorSqlNode: ResolveSavedPriorSqlNode,
    private readonly generateSqlNode: GenerateSqlNode,
    private readonly safetyCheckNode: SafetyCheckNode,
    private readonly executeSqlNode: ExecuteSqlNode,
    private readonly formatAnswerNode: FormatAnswerNode,
    private readonly sqlCorrectionService: SqlCorrectionService,
    private readonly sqlToolRegistry: SqlToolRegistryService,
    private readonly providerRouter: ProviderRouterService,
    private readonly langsmithTrace: LangsmithTraceService,
    private readonly stateMachine: Text2SqlV2StateMachine
  ) {}

  async runSync(input: Text2SqlPreparedRunContext, route: string): Promise<SqlRun> {
    return this.execute(input, route, false);
  }

  async runStream(
    input: Text2SqlPreparedRunContext,
    route: string,
    options?: Text2SqlV2StreamOptions
  ): Promise<SqlRun> {
    return this.execute(input, route, true, options);
  }

  private async execute(
    input: Text2SqlPreparedRunContext,
    route: string,
    streamMode: boolean,
    options?: Text2SqlV2StreamOptions
  ): Promise<SqlRun> {
    const startedAt = new Date().toISOString();
    const trace: ExecutionTrace = {
      runId: input.runId,
      provider: input.session.modelProvider ?? "unknown",
      retryCount: 0,
      steps: []
    };
    const loopEvidence: Text2SqlV2LoopEvidence[] = [];
    let terminationReason: Text2SqlV2TerminationReason | undefined;

    let provider = input.session.modelProvider ?? "unknown";
    let model = input.session.modelName ?? undefined;
    let llmRaw: SqlRun["llmRaw"] = null;
    let retrieval: RetrievedKnowledge | undefined;
    let intentPlan: IntentPlan | undefined;
    let semanticPlan: SemanticQueryPlan | undefined;
    let physicalPlan: PhysicalPlan | undefined;
    let savedPriorSql: SavedPriorSqlResolution = {
      status: "miss",
      reasonCodes: []
    };
    let clarification: ClarificationPrompt | undefined;
    let answer: string | undefined;
    let sql: string | undefined;
    let explanation: string | undefined;
    let rows: Array<Record<string, unknown>> | undefined;
    let columns: string[] | undefined;
    let error: string | undefined;
    const source = this.routeToSource(route);
    const rootTrace = this.langsmithTrace.startRoot({
      runId: input.runId,
      sessionId: input.session.id,
      question: input.question,
      source,
      route,
      requestId: input.requestId
    });
    const stageLifecycle = createText2SqlV2StageLifecycle();

    const stagePolicyMetadata = (
      policy: Text2SqlStageTaskProfilePolicy,
      metadata?: Record<string, unknown>
    ): Record<string, unknown> => ({
      taskProfile: policy.taskProfile,
      reasoningTier: policy.reasoningTier,
      policySource: policy.policySource,
      ...(policy.escalationReason
        ? {
            escalationReason: policy.escalationReason
          }
        : {}),
      ...(metadata ?? {})
    });

    const resolveStagePolicy = (
      stage: Text2SqlV2StageName,
      inputOptions?: {
        escalationReason?: string;
      }
    ): Text2SqlStageTaskProfilePolicy =>
      this.providerRouter.resolveText2SqlStageTaskProfilePolicy({
        stage,
        modelCatalogId: input.session.modelCatalogId ?? undefined,
        provider,
        model,
        escalationReason: inputOptions?.escalationReason
      });

    const startStage = (
      stage: Text2SqlV2StageName,
      inputOptions?: {
        escalationReason?: string;
        metadata?: Record<string, unknown>;
      }
    ): Text2SqlV2StageArtifact => {
      const policy = resolveStagePolicy(stage, inputOptions);
      return stageLifecycle.startStage({
        stage,
        provider: {
          provider: policy.provider,
          model: policy.model
        },
        metadata: stagePolicyMetadata(policy, inputOptions?.metadata)
      });
    };

    const completeStage = (
      stage: Text2SqlV2StageName,
      inputOptions?: {
        status?: Text2SqlV2StageArtifact["status"];
        escalationReason?: string;
        metadata?: Record<string, unknown>;
        warnings?: string[];
      }
    ): Text2SqlV2StageArtifact => {
      const policy = resolveStagePolicy(stage, inputOptions);
      return stageLifecycle.completeStage({
        stage,
        status: inputOptions?.status,
        provider: {
          provider: policy.provider,
          model: policy.model
        },
        warnings: inputOptions?.warnings,
        metadata: stagePolicyMetadata(policy, inputOptions?.metadata)
      });
    };

    const failStage = (
      stage: Text2SqlV2StageName,
      stepError: unknown,
      inputOptions?: {
        escalationReason?: string;
        metadata?: Record<string, unknown>;
        failure?: Partial<NonNullable<Text2SqlV2StageArtifact["failure"]>>;
      }
    ): Text2SqlV2StageArtifact => {
      const policy = resolveStagePolicy(stage, inputOptions);
      return stageLifecycle.completeStage({
        stage,
        status: "failed",
        provider: {
          provider: policy.provider,
          model: policy.model
        },
        failure: toText2SqlV2FailureSemantic(stepError, inputOptions?.failure),
        metadata: stagePolicyMetadata(policy, inputOptions?.metadata)
      });
    };

    const skipStage = (
      stage: Text2SqlV2StageName,
      inputOptions?: {
        metadata?: Record<string, unknown>;
        warnings?: string[];
      }
    ): Text2SqlV2StageArtifact => {
      return completeStage(stage, {
        status: "skipped",
        warnings: inputOptions?.warnings,
        metadata: inputOptions?.metadata
      });
    };

    const getStageArtifact = (
      stage: Text2SqlV2StageName
    ): Text2SqlV2StageArtifact | undefined => stageLifecycle.getStage(stage);

    const recordStep = async (step: Omit<ExecutionTraceStep, "sequence" | "stepId" | "lifecycle">) => {
      const sequence = trace.steps.length + 1;
      const normalized: ExecutionTraceStep = {
        ...step,
        sequence,
        stepId: `${input.runId}:${step.node}:${sequence}`,
        lifecycle:
          step.status === "failed"
            ? "failed"
            : step.status === "skipped"
              ? "skipped"
              : "completed"
      };
      trace.steps.push(normalized);
      await options?.onStep?.({ step: normalized });
      this.langsmithTrace.recordSpan(rootTrace, {
        node: normalized.node,
        status: normalized.status,
        detail: normalized.detail,
        inputs: this.parseStepPayload(normalized.inputSummary),
        outputs: this.parseStepPayload(normalized.outputSummary),
        error: normalized.errorSummary
      });
      return normalized;
    };

    const runStep = async <T>(inputStep: {
      node: string;
      stage?: Text2SqlV2StageName;
      detail?: string;
      inputSummary?: Record<string, unknown>;
      outputSummary?: Record<string, unknown>;
      escalationReason?: string;
      onSuccess?: (result: T) => void;
      onRun: () => Promise<T>;
    }): Promise<T> => {
      const stepStartedAt = new Date().toISOString();
      if (inputStep.stage) {
        startStage(inputStep.stage, {
          escalationReason: inputStep.escalationReason
        });
      }
      try {
        const result = await inputStep.onRun();
        inputStep.onSuccess?.(result);
        const stepEndedAt = new Date().toISOString();
        if (inputStep.stage) {
          completeStage(inputStep.stage, {
            escalationReason: inputStep.escalationReason
          });
        }
        await recordStep({
          node: inputStep.node,
          status: "success",
          detail: inputStep.detail,
          at: stepEndedAt,
          startedAt: stepStartedAt,
          endedAt: stepEndedAt,
          durationMs: this.durationMs(stepStartedAt, stepEndedAt),
          inputSummary: this.stringifyStepSummary(
            inputStep.node,
            "success",
            inputStep.inputSummary,
            inputStep.stage ? getStageArtifact(inputStep.stage) : undefined
          ),
          outputSummary: this.stringifyStepSummary(
            inputStep.node,
            "success",
            inputStep.outputSummary,
            inputStep.stage ? getStageArtifact(inputStep.stage) : undefined
          )
        });
        return result;
      } catch (stepError) {
        const message = this.toErrorMessage(stepError);
        const stepEndedAt = new Date().toISOString();
        if (inputStep.stage) {
          failStage(inputStep.stage, stepError, {
            escalationReason: inputStep.escalationReason
          });
        }
        await recordStep({
          node: inputStep.node,
          status: "failed",
          detail: inputStep.detail,
          at: stepEndedAt,
          startedAt: stepStartedAt,
          endedAt: stepEndedAt,
          durationMs: this.durationMs(stepStartedAt, stepEndedAt),
          inputSummary: this.stringifyStepSummary(
            inputStep.node,
            "failed",
            inputStep.inputSummary,
            inputStep.stage ? getStageArtifact(inputStep.stage) : undefined
          ),
          outputSummary: this.stringifyStepSummary(
            inputStep.node,
            "failed",
            {
              error: message
            },
            inputStep.stage ? getStageArtifact(inputStep.stage) : undefined
          ),
          errorSummary: message
        });
        throw stepError;
      }
    };

    const appendSkippedStep = async (inputStep: {
      node: string;
      stage?: Text2SqlV2StageName;
      detail?: string;
      inputSummary?: Record<string, unknown>;
      outputSummary?: Record<string, unknown>;
    }): Promise<void> => {
      const at = new Date().toISOString();
      await recordStep({
        node: inputStep.node,
        status: "skipped",
        detail: inputStep.detail,
        at,
        startedAt: at,
        endedAt: at,
        durationMs: 0,
        inputSummary: this.stringifyStepSummary(
          inputStep.node,
          "skipped",
          inputStep.inputSummary,
          inputStep.stage ? getStageArtifact(inputStep.stage) : undefined
        ),
        outputSummary: this.stringifyStepSummary(
          inputStep.node,
          "skipped",
          inputStep.outputSummary,
          inputStep.stage ? getStageArtifact(inputStep.stage) : undefined
        )
      });
    };

    const skipRemainingStages = (
      stages: Text2SqlV2StageName[],
      warningPrefix: string
    ) => {
      for (const stage of stages) {
        if (getStageArtifact(stage)) {
          continue;
        }
        skipStage(stage, {
          warnings: [`${warningPrefix}_terminated_before_stage_execution`]
        });
      }
    };

    const handleSemanticPlanControlSignal = (
      runError: unknown
    ): SqlRun | undefined => {
      if (!(runError instanceof DomainError)) {
        return undefined;
      }
      if (
        runError.code !== "SEMANTIC_PLAN_REQUIRES_CLARIFICATION" &&
        runError.code !== "SEMANTIC_PLAN_FAIL_CLOSED" &&
        runError.code !== "SEMANTIC_PLAN_METADATA_ANSWER" &&
        runError.code !== "SEMANTIC_PLAN_GENERAL_ANSWER"
      ) {
        return undefined;
      }

      const controlDetails = this.readSemanticPlanControlDetails(runError);
      const semanticPlanFromError = controlDetails.semanticPlan;
      const reasonCodes = this.unique([
        ...controlDetails.validationReasons,
        ...(semanticPlanFromError?.coverageGaps?.map((item) => item.reasonCode) ?? []),
        runError.code.toLowerCase()
      ]);
      const nextTerminationReason: Text2SqlV2TerminationReason =
        runError.code === "SEMANTIC_PLAN_REQUIRES_CLARIFICATION"
          ? "semantic_plan_requires_clarification"
          : runError.code === "SEMANTIC_PLAN_FAIL_CLOSED"
            ? "semantic_plan_fail_closed"
            : runError.code === "SEMANTIC_PLAN_METADATA_ANSWER"
              ? "semantic_plan_metadata_answer"
              : "semantic_plan_general_answer";

      const lastStep = trace.steps[trace.steps.length - 1];
      if (lastStep?.node === "generate-sql") {
        if (
          runError.code === "SEMANTIC_PLAN_METADATA_ANSWER" ||
          runError.code === "SEMANTIC_PLAN_GENERAL_ANSWER"
        ) {
          lastStep.status = "skipped";
          lastStep.lifecycle = "skipped";
        }
        lastStep.outputSummary = this.stringifyStepSummary(
          "generate-sql",
          lastStep.status === "skipped" ? "skipped" : "failed",
          {
            error: runError.message,
            validation: controlDetails.validation,
            semanticPlan: semanticPlanFromError
          },
          getStageArtifact("generate-sql")
        );
        lastStep.errorSummary = runError.message;
      }

      loopEvidence.push(
        this.buildLoopEvidence({
          loopIndex: loopEvidence.length + 1,
          triggerReason: this.resolveLoopTriggerReason(reasonCodes, runError.message),
          actionType:
            runError.code === "SEMANTIC_PLAN_REQUIRES_CLARIFICATION"
              ? "clarify"
              : runError.code === "SEMANTIC_PLAN_FAIL_CLOSED"
                ? "fail_closed"
                : "continue",
          terminationReason: nextTerminationReason,
          convergencePath:
            runError.code === "SEMANTIC_PLAN_REQUIRES_CLARIFICATION"
              ? ["retrieve", "assemble-context", "semantic-plan", "generate-sql", "clarification"]
              : runError.code === "SEMANTIC_PLAN_FAIL_CLOSED"
                ? ["retrieve", "assemble-context", "semantic-plan", "generate-sql", "reject"]
                : ["retrieve", "assemble-context", "semantic-plan", "answer"],
          semanticPlan: semanticPlanFromError,
          reasonCodes
        })
      );
      terminationReason = nextTerminationReason;

      if (runError.code === "SEMANTIC_PLAN_REQUIRES_CLARIFICATION") {
        clarification =
          clarification ??
          this.buildSemanticPlanClarificationPrompt(semanticPlanFromError, runError.message);
        answer = clarification.question;
        trace.clarificationDecision = {
          ...trace.clarificationDecision,
          decision: "clarify",
          question: clarification.question,
          reason: clarification.reason,
          reasonCodes: this.unique([
            ...(trace.clarificationDecision?.reasonCodes ?? []),
            ...reasonCodes
          ])
        };
        skipRemainingStages(["validate", "correct", "execute", "answer"], runError.code.toLowerCase());
        return finalizeAndTrace("clarification");
      }

      if (
        runError.code === "SEMANTIC_PLAN_METADATA_ANSWER" ||
        runError.code === "SEMANTIC_PLAN_GENERAL_ANSWER"
      ) {
        completeStage("generate-sql", {
          status: "skipped",
          metadata: {
            routeKind:
              runError.code === "SEMANTIC_PLAN_METADATA_ANSWER"
                ? "metadata"
                : "general"
          },
          warnings: [`${runError.code.toLowerCase()}_skipped_sql_generation`]
        });
        answer = this.readSemanticPlanDirectAnswer(runError);
        skipRemainingStages(["validate", "correct", "execute"], runError.code.toLowerCase());
        completeStage("answer", {
          status: "success",
          metadata: {
            routeKind:
              runError.code === "SEMANTIC_PLAN_METADATA_ANSWER"
                ? "metadata"
                : "general"
          }
        });
        return finalizeAndTrace("executionResult");
      }

      error = runError.message;
      skipRemainingStages(["validate", "correct", "execute", "answer"], runError.code.toLowerCase());
      return finalizeAndTrace("rejected");
    };

    const finalize = (status: SqlRun["status"]): SqlRun => {
      const contextEvidence = this.buildContextEvidence({
        contextEnvelope: input.contextEnvelope,
        retrieval,
        planningWarnings: this.unique([
          ...(intentPlan?.planningWarnings ?? []),
          ...(semanticPlan?.planningWarnings?.intent ?? []),
          ...(semanticPlan?.planningWarnings?.semantic ?? [])
        ])
      });

      const run: SqlRun = {
        runId: input.runId,
        sessionId: input.session.id,
        question: input.question,
        status,
        provider,
        model,
        sql,
        explanation,
        answer,
        rows,
        columns,
        error,
        clarification,
        trace: this.withLoopEvidence(
          this.withContextEvidence(trace, contextEvidence),
          {
            loopEvidence,
            terminationReason
          }
        ),
        llmRaw,
        createdAt: startedAt
      };
      return this.attachV2Artifact(run, stageLifecycle.listStages());
    };

    const finalizeAndTrace = (status: SqlRun["status"]): SqlRun => {
      const run = finalize(status);
      this.langsmithTrace.endRoot(rootTrace, {
        status: run.status,
        provider: run.provider,
        outputs: {
          rowCount: run.rows?.length,
          hasError: Boolean(run.error),
          retrievalStatus: retrieval?.retrievalBundle?.status,
          selectedContextCount:
            retrieval?.retrievalBundle?.selected_context?.length ?? 0
        },
        metadata: {
          source,
          route,
          requestId: input.requestId
        }
      });
      return run;
    };

    try {
      const clarificationDecisionRaw = this.clarifyNode.evaluate(
        input.question,
        input.contextEnvelope
      );
      const clarifyStepStatus: ExecutionTraceStep["status"] =
        clarificationDecisionRaw.shouldClarify
          ? "success"
          : clarificationDecisionRaw.bypassed
            ? "skipped"
            : "success";
      trace.clarificationDecision = this.toClarificationDecisionEvidence(
        clarificationDecisionRaw
      );
      clarification = clarificationDecisionRaw.shouldClarify
        ? this.toClarificationPrompt(clarificationDecisionRaw)
        : undefined;
      startStage("intake", {
        metadata: {
          decisionSource: clarificationDecisionRaw.decisionSource,
          triggerPath: clarificationDecisionRaw.triggerPath
        }
      });
      const intakeStage = completeStage("intake", {
        status: clarificationDecisionRaw.shouldClarify ? "clarification" : "success",
        warnings: clarificationDecisionRaw.bypassed ? ["clarify_stage_bypassed"] : undefined,
        metadata: {
          decision: clarificationDecisionRaw.shouldClarify ? "clarify" : "continue",
          bypassed: clarificationDecisionRaw.bypassed
        }
      });

      await recordStep({
        node: "clarify",
        status: clarifyStepStatus,
        detail: clarificationDecisionRaw.shouldClarify
          ? "需要补充澄清信息"
          : clarificationDecisionRaw.bypassed
            ? "澄清阶段按意图旁路"
            : "问题无需澄清",
        at: new Date().toISOString(),
        inputSummary: this.stringifyStepSummary(
          "clarify",
          clarifyStepStatus,
          {
            questionLength: input.question.length,
            hasContextEnvelope: Boolean(input.contextEnvelope)
          },
          intakeStage
        ),
        outputSummary: this.stringifyStepSummary(
          "clarify",
          clarifyStepStatus,
          {
            clarificationDecision: trace.clarificationDecision,
            clarification: clarification ?? null
          },
          intakeStage
        )
      });

      if (clarification) {
        loopEvidence.push(
          this.buildLoopEvidence({
            loopIndex: loopEvidence.length + 1,
            triggerReason: this.resolveLoopTriggerReason(
              trace.clarificationDecision?.reasonCodes,
              clarification.reason
            ),
            actionType: "clarify",
            terminationReason: "clarification_requested",
            convergencePath: ["intake", "clarification"],
            reasonCodes: trace.clarificationDecision?.reasonCodes
          })
        );
        terminationReason = "clarification_requested";
        answer = clarification.question;
        skipStage("retrieve", {
          warnings: ["clarification_terminated_before_stage_execution"]
        });
        skipStage("assemble-context", {
          warnings: ["clarification_terminated_before_stage_execution"]
        });
        skipStage("semantic-plan", {
          warnings: ["clarification_terminated_before_stage_execution"]
        });
        skipStage("generate-sql", {
          warnings: ["clarification_terminated_before_stage_execution"]
        });
        skipStage("validate", {
          warnings: ["clarification_terminated_before_stage_execution"]
        });
        skipStage("correct", {
          warnings: ["clarification_terminated_before_stage_execution"]
        });
        skipStage("execute", {
          warnings: ["clarification_terminated_before_stage_execution"]
        });
        skipStage("answer", {
          warnings: ["clarification_terminated_before_stage_execution"]
        });
        return finalizeAndTrace("clarification");
      }

      retrieval = await runStep({
        node: "retrieve-knowledge",
        stage: "retrieve",
        detail: "执行 RAG 检索与重排",
        inputSummary: {
          datasourceId: input.session.datasource,
          workspaceId: input.session.workspaceId ?? null,
          allowedTables: input.sqlAccessContext?.allowedTables ?? []
        },
        outputSummary: {},
        onRun: async () => {
          const result = await this.retrieveKnowledgeNode.run({
            question: input.question,
            datasourceId: input.session.datasource,
            runId: input.runId,
            workspaceId: input.session.workspaceId ?? undefined,
            allowedTables: input.sqlAccessContext?.allowedTables,
            modelCatalogId: input.session.modelCatalogId ?? undefined,
            pinnedTables: input.contextEnvelope?.pinnedTables,
            pinnedColumns: input.contextEnvelope?.pinnedColumns
          });
          return result;
        }
      });

      trace.steps[trace.steps.length - 1]!.outputSummary = this.stringifyStepSummary(
        "retrieve-knowledge",
        "success",
        {
          status: retrieval.status,
          summary: retrieval.summary,
          selectedContextCount: retrieval.retrievalBundle?.selected_context?.length ?? 0,
          candidateCount: retrieval.retrievalBundle?.candidates.length ?? 0,
          retrievalDegradeReasons: retrieval.retrievalBundle?.degrade_reasons ?? [],
          riskTags: retrieval.retrievalBundle?.risk_tags ?? []
        },
        getStageArtifact("retrieve")
      );

      intentPlan = await runStep({
        node: "build-intent-plan",
        stage: "assemble-context",
        detail: "生成意图规划",
        inputSummary: {
          retrievalStatus: retrieval.status,
          snippetCount: retrieval.snippets.length
        },
        outputSummary: {},
        onRun: () =>
          this.buildIntentPlanNode.run(
            input.question,
            retrieval as RetrievedKnowledge,
            trace.clarificationDecision
          )
      });

      trace.clarificationDecision =
        intentPlan.clarificationDecision ?? trace.clarificationDecision;

      trace.steps[trace.steps.length - 1]!.outputSummary = this.stringifyStepSummary(
        "build-intent-plan",
        "success",
        {
          status: intentPlan.status,
          intent: intentPlan.intent,
          uncertainty: intentPlan.uncertaintySignal,
          riskTags: intentPlan.riskTags ?? [],
          planningWarnings: intentPlan.planningWarnings ?? [],
          clarificationDecision: trace.clarificationDecision
        },
        getStageArtifact("assemble-context")
      );

      semanticPlan = await runStep({
        node: "build-semantic-query",
        stage: "semantic-plan",
        detail: "生成语义计划",
        inputSummary: {
          intent: intentPlan.intent,
          strictMode: intentPlan.uncertaintySignal?.needsStrictSemanticPath ?? false
        },
        outputSummary: {},
        onRun: () =>
          this.buildSemanticQueryNode.run({
            intentPlan: intentPlan as IntentPlan,
            question: input.question,
            retrievalBundle: retrieval?.retrievalBundle,
            clarificationDecision: trace.clarificationDecision
          })
      });

      trace.steps[trace.steps.length - 1]!.outputSummary = this.stringifyStepSummary(
        "build-semantic-query",
        "success",
        {
          status: semanticPlan.status,
          semanticVersion: semanticPlan.semanticVersion,
          lockStatus: semanticPlan.lockStatus,
          fallbackApplied: semanticPlan.fallbackApplied,
          riskTags: semanticPlan.riskTags,
          strictMode: semanticPlan.strictMode,
          strictModeReasons: semanticPlan.strictModeReasons ?? []
        },
        getStageArtifact("semantic-plan")
      );

      physicalPlan = await runStep({
        node: "build-physical-plan",
        stage: "semantic-plan",
        detail: "生成物理执行计划",
        inputSummary: {
          semanticStatus: semanticPlan.status,
          lockStatus: semanticPlan.lockStatus
        },
        outputSummary: {},
        onRun: () =>
          this.buildPhysicalPlanNode.run({
            semanticPlan: semanticPlan as SemanticQueryPlan,
            question: input.question,
            datasourceId: input.session.datasource
          })
      });

      trace.steps[trace.steps.length - 1]!.outputSummary = this.stringifyStepSummary(
        "build-physical-plan",
        "success",
        {
          status: physicalPlan.status,
          strategy: physicalPlan.strategy,
          lockStatus: physicalPlan.lockStatus,
          cacheStatus: physicalPlan.cacheStatus,
          cacheReason: physicalPlan.cacheReason
        },
        getStageArtifact("semantic-plan")
      );

      savedPriorSql = await runStep({
        node: "resolve-saved-prior-sql",
        stage: "generate-sql",
        detail: "判定是否复用已保存 SQL",
        inputSummary: {
          candidateCount: retrieval?.retrievalBundle?.candidates.length ?? 0
        },
        outputSummary: {},
        onRun: async () =>
          this.resolveSavedPriorSqlNode.run({
            retrievalBundle: retrieval?.retrievalBundle,
            question: input.question
          })
      });

      trace.steps[trace.steps.length - 1]!.outputSummary = this.stringifyStepSummary(
        "resolve-saved-prior-sql",
        "success",
        {
          status: savedPriorSql.status,
          reasonCodes: savedPriorSql.reasonCodes,
          selectedChunkId: savedPriorSql.selectedChunkId,
          selectedViewId: savedPriorSql.selectedViewId
        },
        getStageArtifact("generate-sql")
      );

      const runGenerateSql = async (cause: "initial" | "shortcut-fallback" | "correction") => {
        const stepDetailMap: Record<typeof cause, string> = {
          initial: "生成 SQL",
          "shortcut-fallback": "shortcut SQL 安全拒绝后回退生成 SQL",
          correction: "根据执行错误进行 SQL 修正"
        };
        const tools = streamMode
          ? this.sqlToolRegistry.getToolsForDatasource(input.datasource, {
              accessContext: input.sqlAccessContext
            })
          : undefined;
        const draft = await runStep({
          node: "generate-sql",
          stage: "generate-sql",
          detail: stepDetailMap[cause],
          escalationReason:
            cause === "correction"
              ? "correction_retry_after_execution_error"
              : undefined,
          inputSummary: {
            cause,
            retrievalStatus: retrieval?.status,
            selectedContextCount:
              retrieval?.retrievalBundle?.selected_context?.length ?? 0,
            retrievalDegradeReasons: retrieval?.retrievalBundle?.degrade_reasons ?? [],
            semanticLockStatus: semanticPlan?.lockStatus,
            semanticVersion: semanticPlan?.semanticVersion,
            strategy: physicalPlan?.strategy
          },
          outputSummary: {},
          onSuccess: (generated) => {
            provider = generated.provider;
            model = generated.model;
            llmRaw = {
              provider: generated.provider,
              model: generated.model,
              rawText: generated.rawText,
              createdAt: new Date().toISOString()
            };
            trace.promptTemplate = generated.promptTemplate;
          },
          onRun: () =>
            this.generateSqlNode.run(input.question, input.datasource.type, input.session.modelCatalogId ?? undefined, {
              stream: streamMode,
              tools,
              onEvent: options?.onLlmEvent,
              selectedContext: retrieval?.retrievalBundle?.selected_context,
              retrievalBundle: retrieval?.retrievalBundle,
              semanticContextPack: retrieval?.contextPack,
              datasourceId: input.session.datasource,
              workspaceId: input.session.workspaceId ?? undefined,
              explicitPinning: {
                source: "context-envelope",
                tables: input.contextEnvelope?.pinnedTables,
                columns: input.contextEnvelope?.pinnedColumns
              },
              allowedTables: input.sqlAccessContext?.allowedTables
            })
        });
        completeStage("generate-sql", {
          escalationReason:
            cause === "correction"
              ? "correction_retry_after_execution_error"
              : undefined,
          metadata: {
            cause
          }
        });

        trace.steps[trace.steps.length - 1]!.outputSummary = this.stringifyStepSummary(
          "generate-sql",
          "success",
          {
            provider: draft.provider,
            model: draft.model,
            sql: draft.sql,
            explanation: draft.explanation,
            retryCount: draft.retryCount,
            semanticIntent: draft.semanticIntent,
            coverage: draft.coverage,
            semanticContextPack: draft.semanticContextPack,
            semanticPlan: draft.semanticPlan
          },
          getStageArtifact("generate-sql")
        );

        return draft;
      };

      let generatedDraft:
        | Awaited<ReturnType<GenerateSqlNode["run"]>>
        | undefined = undefined;

      if (savedPriorSql.status === "hit" && savedPriorSql.sql) {
        sql = savedPriorSql.sql;
        explanation = savedPriorSql.explanation;
        await appendSkippedStep({
          node: "generate-sql",
          stage: "generate-sql",
          detail: "命中 saved prior SQL shortcut，跳过模型生成",
          outputSummary: {
            status: "shortcut_hit",
            selectedViewId: savedPriorSql.selectedViewId,
            selectedSourceRunId: savedPriorSql.selectedSourceRunId
          }
        });
      } else {
        try {
          generatedDraft = await runGenerateSql("initial");
        } catch (runError) {
          const handledRun = handleSemanticPlanControlSignal(runError);
          if (handledRun) {
            return handledRun;
          }
          throw runError;
        }
        sql = generatedDraft.sql;
        explanation = generatedDraft.explanation;
      }

      if (!sql) {
        throw new DomainError("TEXT2SQL_V2_SQL_EMPTY", "SQL 生成为空", 500);
      }

      const runSafetyCheck = async (reason: string) => {
        const decision = await runStep({
          node: "safety-check",
          stage: "validate",
          detail: reason,
          inputSummary: {
            sqlPreview: sql?.slice(0, 180),
            datasourceId: input.session.datasource,
            semanticPlanRoute: generatedDraft?.semanticPlan?.route
          },
          outputSummary: {},
          onRun: () =>
            this.safetyCheckNode.run({
              sql: sql as string,
              datasourceId: input.session.datasource,
              datasourceType: input.datasource.type,
              semanticPlan: generatedDraft?.semanticPlan,
              accessContext: input.sqlAccessContext,
              riskTags: semanticPlan?.riskTags
            })
        });

        const step = trace.steps[trace.steps.length - 1];
        if (step) {
          if (!decision.allowed) {
            failStage("validate", decision.reason ?? "validation failed", {
              failure: {
                code: "VALIDATION_REJECTED",
                category: "governance",
                terminal: true,
                correctable: false
              },
              metadata: {
                mode: decision.mode,
                riskLevel: decision.riskLevel
              }
            });
          } else {
            completeStage("validate", {
              metadata: {
                mode: decision.mode,
                riskLevel: decision.riskLevel
              }
            });
          }
          step.outputSummary = this.stringifyStepSummary(
            "safety-check",
            decision.allowed ? "success" : "failed",
            {
              allowed: decision.allowed,
              mode: decision.mode,
              riskLevel: decision.riskLevel,
              riskTags: decision.riskTags,
              reason: decision.reason
            },
            getStageArtifact("validate")
          );
          if (!decision.allowed) {
            step.status = "failed";
            step.lifecycle = "failed";
            step.errorSummary = decision.reason;
          }
        }

        return decision;
      };

      let safetyDecision = await runSafetyCheck("执行 SQL 安全校验");
      if (!safetyDecision.allowed && savedPriorSql.status === "hit") {
        try {
          generatedDraft = await runGenerateSql("shortcut-fallback");
        } catch (runError) {
          const handledRun = handleSemanticPlanControlSignal(runError);
          if (handledRun) {
            return handledRun;
          }
          throw runError;
        }
        sql = generatedDraft.sql;
        explanation = generatedDraft.explanation;
        safetyDecision = await runSafetyCheck("shortcut 回退后重新执行安全校验");
      }

      if (!safetyDecision.allowed) {
        error = safetyDecision.reason ?? "请求触发只读策略，已拒绝执行";
        return finalizeAndTrace("rejected");
      }

      let correctionAttempt = 0;
      while (true) {
        try {
          const executionResult = await runStep({
            node: "execute-sql",
            stage: "execute",
            detail: "执行 SQL",
            inputSummary: {
              sqlPreview: sql?.slice(0, 180),
              accessTables: input.sqlAccessContext?.allowedTables ?? []
            },
            outputSummary: {},
            onRun: () =>
              this.executeSqlNode.run({
                sql: sql as string,
                datasourceId: input.session.datasource,
                sessionId: input.session.id,
                requestId: input.requestId,
                accessContext: input.sqlAccessContext as SqlTableAccessContext | undefined
              })
          });

          rows = executionResult.rows;
          columns = executionResult.columns;
          trace.steps[trace.steps.length - 1]!.outputSummary = this.stringifyStepSummary(
            "execute-sql",
            "success",
            {
              rowCount: rows.length,
              columnCount: columns.length
            },
            getStageArtifact("execute")
          );
          break;
        } catch (executeError) {
          const correctionDecision = this.sqlCorrectionService.decide(executeError);
          if (
            !correctionDecision.correctable ||
            correctionAttempt >= correctionDecision.maxAttempts
          ) {
            throw executeError;
          }
          correctionAttempt += 1;
          trace.retryCount = correctionAttempt;

          await runStep({
            node: "relationship-correction",
            stage: "correct",
            detail: "执行错误可修正，触发 correction 迭代",
            escalationReason: "execution_error_correction_retry",
            inputSummary: {
              retryCount: correctionAttempt,
              reason: correctionDecision.reason
            },
            outputSummary: {
              retryCount: correctionAttempt,
              maxAttempts: correctionDecision.maxAttempts
            },
            onRun: async () => undefined
          });

          try {
            generatedDraft = await runGenerateSql("correction");
          } catch (runError) {
            const handledRun = handleSemanticPlanControlSignal(runError);
            if (handledRun) {
              return handledRun;
            }
            throw runError;
          }
          sql = generatedDraft.sql;
          explanation = generatedDraft.explanation;

          const correctionSafety = await runSafetyCheck(
            "correction 后重新执行安全校验"
          );
          if (!correctionSafety.allowed) {
            error = correctionSafety.reason ?? "修正 SQL 未通过安全策略";
            return finalizeAndTrace("rejected");
          }
        }
      }

      answer = await runStep({
        node: "format-answer",
        stage: "answer",
        detail: "整理自然语言回答",
        inputSummary: {
          rowCount: rows?.length ?? 0,
          columnCount: columns?.length ?? 0
        },
        outputSummary: {},
        onRun: async () =>
          this.formatAnswerNode.run(input.question, rows ?? [], columns ?? [])
      });

      trace.steps[trace.steps.length - 1]!.outputSummary = this.stringifyStepSummary(
        "format-answer",
        "success",
        {
          answerPreview: answer.slice(0, 200)
        },
        getStageArtifact("answer")
      );

      return finalizeAndTrace("executionResult");
    } catch (runError) {
      error = this.toErrorMessage(runError);
      return finalizeAndTrace("failed");
    }
  }

  private attachV2Artifact(
    run: SqlRun,
    stageArtifacts: Text2SqlV2StageArtifact[]
  ): SqlRun {
    const v2Artifact = this.stateMachine.buildRunArtifact(run, {
      stageArtifacts
    });
    return {
      ...run,
      trace: {
        ...run.trace,
        v2: v2Artifact
      }
    };
  }

  private toClarificationDecisionEvidence(
    decision: ClarifyDecisionRaw
  ): ClarificationDecisionEvidence {
    return {
      decision: decision.shouldClarify ? "clarify" : "continue",
      triggerPath: decision.triggerPath,
      decisionSource: decision.decisionSource,
      bypassed: decision.bypassed,
      ...(decision.bypassReasonCode
        ? {
            bypassReasonCode: decision.bypassReasonCode
          }
        : {}),
      confidenceLevel: decision.confidenceLevel,
      missingCriticalSlots: decision.missingCriticalSlots,
      reasonCodes: decision.reasonCodes,
      question: decision.question,
      reason: decision.reason
    };
  }

  private toClarificationPrompt(decision: ClarifyDecisionRaw): ClarificationPrompt {
    return {
      question: decision.question,
      reason: decision.reason,
      decision: "clarify",
      triggerPath: decision.triggerPath,
      decisionSource: decision.decisionSource,
      bypassed: decision.bypassed,
      ...(decision.bypassReasonCode
        ? {
            bypassReasonCode: decision.bypassReasonCode
          }
        : {}),
      confidenceLevel: decision.confidenceLevel,
      missingCriticalSlots: decision.missingCriticalSlots,
      reasonCodes: decision.reasonCodes
    };
  }

  private stringifyStepSummary(
    node: string,
    status: "success" | "failed" | "skipped",
    payload?: Record<string, unknown>,
    stageArtifact?: Text2SqlV2StageArtifact
  ): string | undefined {
    if (!payload) {
      return undefined;
    }
    const summary: Record<string, unknown> = {
      ...payload,
      ...(stageArtifact
        ? {
            v2: {
              stageArtifact
            }
          }
        : {})
    };
    try {
      return JSON.stringify(summary);
    } catch {
      return undefined;
    }
  }

  private withContextEvidence(
    trace: ExecutionTrace,
    contextEvidence: ExecutionContextEvidence
  ): ExecutionTrace {
    if (!contextEvidence.effectiveContextSummary && !contextEvidence.conflictHint) {
      return trace;
    }
    return {
      ...trace,
      ...(contextEvidence.effectiveContextSummary
        ? {
            effectiveContextSummary: contextEvidence.effectiveContextSummary
          }
        : {}),
      ...(contextEvidence.conflictHint
        ? {
            conflictHint: contextEvidence.conflictHint
          }
        : {})
    };
  }

  private withLoopEvidence(
    trace: ExecutionTrace,
    input: {
      loopEvidence: Text2SqlV2LoopEvidence[];
      terminationReason?: Text2SqlV2TerminationReason;
    }
  ): ExecutionTrace {
    if (input.loopEvidence.length === 0 && !input.terminationReason) {
      return trace;
    }
    return {
      ...trace,
      ...(input.loopEvidence.length > 0
        ? {
            loopEvidence: input.loopEvidence.map((item) => ({
              ...item,
              ...(item.planDelta
                ? {
                    planDelta: {
                      ...item.planDelta,
                      ...(item.planDelta.route
                        ? {
                            route: {
                              ...item.planDelta.route
                            }
                          }
                        : {})
                    }
                  }
                : {})
            }))
          }
        : {}),
      ...(input.terminationReason
        ? {
            terminationReason: input.terminationReason
          }
        : {})
    };
  }

  private readSemanticPlanControlDetails(error: DomainError): {
    semanticPlan?: SemanticPlanV1;
    validation?: Record<string, unknown>;
    validationReasons: string[];
  } {
    const details = error.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      return {
        validationReasons: []
      };
    }
    const detailRecord = details as Record<string, unknown>;
    const semanticPlan = this.readSemanticPlan(detailRecord.semanticPlan);
    const validation =
      detailRecord.validation &&
      typeof detailRecord.validation === "object" &&
      !Array.isArray(detailRecord.validation)
        ? (detailRecord.validation as Record<string, unknown>)
        : undefined;
    const validationReasons = Array.isArray(validation?.reasons)
      ? validation.reasons.filter((item): item is string => typeof item === "string")
      : [];
    return {
      semanticPlan,
      validation,
      validationReasons
    };
  }

  private readSemanticPlanDirectAnswer(error: DomainError): string {
    const details = error.details;
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const answer = (details as Record<string, unknown>).answer;
      if (typeof answer === "string" && answer.trim().length > 0) {
        return answer.trim();
      }
    }
    return error.message;
  }

  private readSemanticPlan(value: unknown): SemanticPlanV1 | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const plan = value as Partial<SemanticPlanV1>;
    if (
      plan.route !== "answer" &&
      plan.route !== "clarify" &&
      plan.route !== "reject"
    ) {
      return undefined;
    }
    if (typeof plan.standaloneQuestion !== "string") {
      return undefined;
    }
    return {
      route: plan.route,
      standaloneQuestion: plan.standaloneQuestion,
      selectedTables: Array.isArray(plan.selectedTables) ? plan.selectedTables : [],
      selectedColumns: Array.isArray(plan.selectedColumns) ? plan.selectedColumns : [],
      confidence:
        typeof plan.confidence === "number" && Number.isFinite(plan.confidence)
          ? plan.confidence
          : 0,
      evidenceRefs: Array.isArray(plan.evidenceRefs) ? plan.evidenceRefs : [],
      ...(Array.isArray(plan.metrics) ? { metrics: plan.metrics } : {}),
      ...(typeof plan.grain === "string" ? { grain: plan.grain } : {}),
      ...(Array.isArray(plan.filters) ? { filters: plan.filters } : {}),
      ...(Array.isArray(plan.joinPath) ? { joinPath: plan.joinPath } : {}),
      ...(Array.isArray(plan.allowedTables) ? { allowedTables: plan.allowedTables } : {}),
      ...(Array.isArray(plan.forbiddenTables)
        ? { forbiddenTables: plan.forbiddenTables }
        : {}),
      ...(Array.isArray(plan.coverageGaps) ? { coverageGaps: plan.coverageGaps } : {}),
      ...(typeof plan.snapshotId === "string" ? { snapshotId: plan.snapshotId } : {})
    };
  }

  private buildSemanticPlanClarificationPrompt(
    semanticPlan: SemanticPlanV1 | undefined,
    fallbackReason: string
  ): ClarificationPrompt {
    const coverageReason =
      semanticPlan?.coverageGaps
        ?.map((item) => item.reasonCode)
        .slice(0, 2)
        .join("、") ?? "";
    const question =
      semanticPlan?.coverageGaps?.some((item) => item.subjectKind === "time")
        ? "请补充时间范围或统计窗口，以便继续生成 SQL。"
        : semanticPlan?.coverageGaps?.some((item) => item.subjectKind === "metric")
          ? "请补充要统计的指标或分析对象，以便继续生成 SQL。"
          : "请补充更明确的分析对象、指标或时间范围，以便继续生成 SQL。";
    return {
      question,
      reason: coverageReason || fallbackReason,
      decision: "clarify",
      triggerPath: "semantic",
      confidenceLevel: "low",
      reasonCodes: this.unique([
        ...(semanticPlan?.coverageGaps?.map((item) => item.reasonCode) ?? []),
        "semantic_plan_requires_clarification"
      ])
    };
  }

  private buildLoopEvidence(input: {
    loopIndex: number;
    triggerReason: string;
    actionType: Text2SqlV2LoopEvidence["actionType"];
    terminationReason: Text2SqlV2TerminationReason;
    convergencePath: string[];
    semanticPlan?: SemanticPlanV1;
    reasonCodes?: string[];
  }): Text2SqlV2LoopEvidence {
    return {
      loopIndex: input.loopIndex,
      triggerReason: input.triggerReason,
      actionType: input.actionType,
      planDelta: {
        route: {
          to: input.semanticPlan?.route ?? (input.actionType === "fail_closed" ? "reject" : "clarify")
        },
        ...(input.semanticPlan?.snapshotId
          ? {
              snapshotId: input.semanticPlan.snapshotId
            }
          : {}),
        ...(input.semanticPlan?.coverageGaps?.length
          ? {
              addedCoverageGapTypes: input.semanticPlan.coverageGaps.map(
                (item) => item.gapType
              )
            }
          : {}),
        ...(input.reasonCodes?.length
          ? {
              reasonCodes: this.unique(input.reasonCodes)
            }
          : {})
      },
      terminationReason: input.terminationReason,
      convergencePath: input.convergencePath
    };
  }

  private resolveLoopTriggerReason(
    reasonCodes: string[] | undefined,
    fallbackMessage: string
  ): string {
    const normalized = this.unique(reasonCodes ?? []);
    if (normalized.length > 0) {
      return normalized.join("|");
    }
    return fallbackMessage.trim();
  }

  private buildContextEvidence(input: {
    contextEnvelope?: ContextEnvelope;
    retrieval?: RetrievedKnowledge;
    planningWarnings?: string[];
  }): ExecutionContextEvidence {
    const envelope = input.contextEnvelope;
    if (!this.hasContextEnvelope(envelope)) {
      return {};
    }

    const includeTableCount = this.countNonEmptyStrings(envelope?.mustIncludeTables);
    const excludeTableCount = this.countNonEmptyStrings(envelope?.mustExcludeTables);
    const pinnedTableCount = this.countNonEmptyStrings(envelope?.pinnedTables);
    const pinnedColumnCount = this.countNonEmptyStrings(envelope?.pinnedColumns);

    const effectiveContextSummary: NonNullable<SqlRun["trace"]>["effectiveContextSummary"] = {
      sourcePriority: "user_explicit_over_system",
      userEnvelope: {
        metricDefinitionProvided: this.hasNonEmptyString(envelope?.metricDefinition),
        timeRangeProvided: this.hasTimeRange(envelope?.timeRange),
        entityMappingCount: this.countEntityMappings(envelope?.entityMappings),
        includeTableCount,
        excludeTableCount,
        ...(pinnedTableCount > 0 ? { pinnedTableCount } : {}),
        ...(pinnedColumnCount > 0 ? { pinnedColumnCount } : {}),
        businessConstraintCount: this.countNonEmptyStrings(
          envelope?.businessConstraints
        )
      },
      retrievalContext: {
        status: input.retrieval?.retrievalBundle?.status,
        selectedContextCount:
          input.retrieval?.retrievalBundle?.selected_context?.length,
        ...(input.retrieval?.pinning
          ? {
              pinning: input.retrieval.pinning
            }
          : {})
      }
    };

    const reasonCodes = this.collectConflictReasons({
      envelope,
      includeTableCount,
      excludeTableCount,
      retrievalRiskTags: input.retrieval?.retrievalBundle?.risk_tags ?? [],
      planningWarnings: input.planningWarnings ?? []
    });

    return {
      effectiveContextSummary,
      conflictHint: {
        hasConflict: reasonCodes.length > 0,
        preferredSource: "user_explicit",
        ...(reasonCodes.length > 0 ? { reasonCodes } : {})
      }
    };
  }

  private collectConflictReasons(input: {
    envelope?: ContextEnvelope;
    includeTableCount: number;
    excludeTableCount: number;
    retrievalRiskTags: string[];
    planningWarnings: string[];
  }): string[] {
    const reasonCodes: string[] = [];
    if (
      input.includeTableCount > 0 &&
      input.excludeTableCount > 0 &&
      this.hasTableOverlap(input.envelope)
    ) {
      reasonCodes.push("user_envelope_include_exclude_overlap");
    }
    if (input.retrievalRiskTags.some((tag) => CONTEXT_CONFLICT_REGEX.test(tag))) {
      reasonCodes.push("retrieval_context_conflict_risk");
    }
    if (input.planningWarnings.some((warning) => CONTEXT_CONFLICT_REGEX.test(warning))) {
      reasonCodes.push("planning_conflict_warning");
    }
    return this.unique(reasonCodes);
  }

  private hasTableOverlap(envelope: ContextEnvelope | undefined): boolean {
    const include = new Set(
      (envelope?.mustIncludeTables ?? [])
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    );
    if (include.size === 0) {
      return false;
    }
    return (envelope?.mustExcludeTables ?? [])
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .some((item) => include.has(item));
  }

  private hasContextEnvelope(input: ContextEnvelope | undefined): boolean {
    if (!input) {
      return false;
    }
    return (
      this.hasNonEmptyString(input.metricDefinition) ||
      this.hasTimeRange(input.timeRange) ||
      this.countEntityMappings(input.entityMappings) > 0 ||
      this.countNonEmptyStrings(input.mustIncludeTables) > 0 ||
      this.countNonEmptyStrings(input.mustExcludeTables) > 0 ||
      this.countNonEmptyStrings(input.pinnedTables) > 0 ||
      this.countNonEmptyStrings(input.pinnedColumns) > 0 ||
      this.countNonEmptyStrings(input.businessConstraints) > 0
    );
  }

  private hasTimeRange(value: ContextEnvelope["timeRange"] | undefined): boolean {
    if (!value || typeof value !== "object") {
      return false;
    }
    return (
      this.hasNonEmptyString(value.from) ||
      this.hasNonEmptyString(value.to) ||
      this.hasNonEmptyString(value.timezone)
    );
  }

  private countEntityMappings(value: ContextEnvelope["entityMappings"] | undefined): number {
    if (!Array.isArray(value)) {
      return 0;
    }
    return value.reduce((count, item) => {
      if (!item || typeof item !== "object") {
        return count;
      }
      if (this.hasNonEmptyString(item.entity) || this.hasNonEmptyString(item.mappedTo)) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  private countNonEmptyStrings(values: string[] | undefined): number {
    if (!values) {
      return 0;
    }
    return values.filter((item) => this.hasNonEmptyString(item)).length;
  }

  private hasNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  private durationMs(startedAt: string, endedAt: string): number {
    const start = Date.parse(startedAt);
    const end = Date.parse(endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return 0;
    }
    return Math.max(0, end - start);
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof DomainError || error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private parseStepPayload(
    payload: string | undefined
  ): Record<string, unknown> | undefined {
    if (!payload) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private routeToSource(route: string): RunRouteSource {
    return route.includes("/evaluations/") ? "evaluation" : "chat";
  }
}
