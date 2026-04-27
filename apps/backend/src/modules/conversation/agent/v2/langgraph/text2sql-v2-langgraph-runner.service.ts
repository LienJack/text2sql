import { Injectable } from "@nestjs/common";
import type { ExecutionTraceStep, SqlRun } from "@text2sql/shared-types";
import type { Text2SqlPreparedRunContext } from "../../../text2sql/stages/prepare-run.stage";
import { SqlToolRegistryService } from "../../sql/tools/sql-tool-registry.service";
import {
  createText2SqlV2LangGraph,
  type Text2SqlV2LangGraphCompiled
} from "./text2sql-v2-langgraph.graph";
import { Text2SqlV2LangGraphResultMapper } from "./text2sql-v2-langgraph-result.mapper";
import {
  createText2SqlV2LangGraphInitialState,
  type Text2SqlV2LangGraphRuntimeInput,
  type Text2SqlV2LangGraphState,
  type Text2SqlV2LangGraphStreamOptions
} from "./text2sql-v2-langgraph.state";
import { LangsmithTraceService } from "../../../../observability/langsmith-trace.service";
import type { LangsmithTraceSource } from "../../../../observability/langsmith.types";
import { AnswerNode } from "./nodes/answer.node";
import { AssembleContextNode } from "./nodes/assemble-context.node";
import { CorrectSqlNode } from "./nodes/correct-sql.node";
import { ExecuteSqlNode } from "./nodes/execute-sql.node";
import { GenerateSqlNode } from "./nodes/generate-sql.node";
import { IntakeNode } from "./nodes/intake.node";
import { RetrieveContextNode } from "./nodes/retrieve-context.node";
import { SemanticPlanNode } from "./nodes/semantic-plan.node";
import { ValidateSqlNode } from "./nodes/validate-sql.node";

@Injectable()
export class Text2SqlV2LangGraphRunnerService {
  private compiledGraph?: Text2SqlV2LangGraphCompiled;

  constructor(
    private readonly intakeNode: IntakeNode,
    private readonly retrieveContextNode: RetrieveContextNode,
    private readonly assembleContextNode: AssembleContextNode,
    private readonly semanticPlanNode: SemanticPlanNode,
    private readonly generateSqlNode: GenerateSqlNode,
    private readonly validateSqlNode: ValidateSqlNode,
    private readonly correctSqlNode: CorrectSqlNode,
    private readonly executeSqlNode: ExecuteSqlNode,
    private readonly answerNode: AnswerNode,
    private readonly sqlToolRegistry: SqlToolRegistryService,
    private readonly langsmithTrace: LangsmithTraceService,
    private readonly resultMapper: Text2SqlV2LangGraphResultMapper
  ) {}

  async runSync(input: Text2SqlPreparedRunContext, route: string): Promise<SqlRun> {
    return this.runWithGraph({
      preparedRun: input,
      route,
      streamMode: false
    });
  }

  async runStream(
    input: Text2SqlPreparedRunContext,
    route: string,
    options?: Text2SqlV2LangGraphStreamOptions
  ): Promise<SqlRun> {
    return this.runWithGraph({
      preparedRun: input,
      route,
      streamMode: true,
      streamOptions: options
    });
  }

  private async runWithGraph(
    runtimeInput: Text2SqlV2LangGraphRuntimeInput
  ): Promise<SqlRun> {
    const source = this.routeToSource(runtimeInput.route);
    const rootTrace = this.langsmithTrace.startRoot({
      runId: runtimeInput.preparedRun.runId,
      sessionId: runtimeInput.preparedRun.session.id,
      question: runtimeInput.preparedRun.question,
      source,
      route: runtimeInput.route,
      requestId: runtimeInput.preparedRun.requestId
    });

    try {
      const finalState = (await this.getCompiledGraph().invoke(
        createText2SqlV2LangGraphInitialState(runtimeInput)
      )) as Text2SqlV2LangGraphState;
      const traceSteps = this.resultMapper.mapTraceSteps(finalState);

      if (runtimeInput.streamMode && runtimeInput.streamOptions?.onStep) {
        for (const step of traceSteps) {
          await runtimeInput.streamOptions.onStep({ step });
        }
      }

      this.recordLangsmithSpans(rootTrace, traceSteps);

      const run = this.resultMapper.mapSqlRun(finalState);
      this.langsmithTrace.endRoot(rootTrace, {
        status: run.status,
        provider: run.provider,
        outputs: {
          rowCount: run.rows?.length,
          hasError: Boolean(run.error),
          retrievalStatus: run.trace.v2?.contextPack?.status,
          selectedContextCount: run.trace.v2?.contextPack?.selectedEvidenceIds?.length ?? 0
        },
        metadata: {
          source,
          route: runtimeInput.route,
          requestId: runtimeInput.preparedRun.requestId
        }
      });

      return run;
    } catch (error) {
      this.langsmithTrace.endRoot(rootTrace, {
        status: "failed",
        metadata: {
          source,
          route: runtimeInput.route,
          requestId: runtimeInput.preparedRun.requestId
        },
        error: this.toErrorMessage(error)
      });
      throw error;
    }
  }

  private recordLangsmithSpans(
    rootTrace: ReturnType<LangsmithTraceService["startRoot"]>,
    steps: ExecutionTraceStep[]
  ): void {
    for (const step of steps) {
      this.langsmithTrace.recordSpan(rootTrace, {
        node: step.node,
        status: step.status,
        detail: step.detail,
        inputs: this.parseStepPayload(step.inputSummary),
        outputs: this.parseStepPayload(step.outputSummary),
        error: step.errorSummary
      });
    }
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

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private routeToSource(route: string): LangsmithTraceSource {
    return route.includes("/evaluations/") ? "evaluation" : "chat";
  }

  private getCompiledGraph(): Text2SqlV2LangGraphCompiled {
    if (!this.compiledGraph) {
      this.compiledGraph = createText2SqlV2LangGraph({
        intakeNode: this.intakeNode,
        retrieveContextNode: this.retrieveContextNode,
        assembleContextNode: this.assembleContextNode,
        semanticPlanNode: this.semanticPlanNode,
        generateSqlNode: this.generateSqlNode,
        validateSqlNode: this.validateSqlNode,
        correctSqlNode: this.correctSqlNode,
        executeSqlNode: this.executeSqlNode,
        answerNode: this.answerNode,
        resolveSqlTools: (state) =>
          this.sqlToolRegistry.getToolsForDatasource(
            state.preparedRun.datasource,
            {
              accessContext: state.preparedRun.sqlAccessContext
            }
          )
      });
    }
    return this.compiledGraph;
  }
}
