import { Injectable } from "@nestjs/common";
import type { ExecutionTraceStep, SqlRun } from "@text2sql/shared-types";
import type { LlmGatewayStreamEvent } from "../../../llm/llm-gateway.interface";
import { GraphBuilderService } from "../../agent/graph/graph.builder";
import { SqlToolRegistryService } from "../../agent/sql/tools/sql-tool-registry.service";
import type { Text2SqlPreparedRunContext } from "./prepare-run.stage";

export interface Text2SqlStreamGraphOptions {
  onLlmEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
  onStep?: (event: { step: ExecutionTraceStep }) => Promise<void> | void;
}

@Injectable()
export class RunAgentGraphStage {
  constructor(
    private readonly graphBuilder: GraphBuilderService,
    private readonly sqlToolRegistry: SqlToolRegistryService
  ) {}

  runSync(input: Text2SqlPreparedRunContext, route: string): Promise<SqlRun> {
    return this.graphBuilder.run({
      runId: input.runId,
      sessionId: input.session.id,
      question: input.question,
      datasourceId: input.session.datasource,
      datasourceType: input.datasource.type,
      modelCatalogId: input.session.modelCatalogId ?? undefined,
      contextEnvelope: input.contextEnvelope,
      accessContext: input.sqlAccessContext,
      traceContext: {
        source: "chat",
        route,
        requestId: input.requestId
      }
    });
  }

  runStream(
    input: Text2SqlPreparedRunContext,
    route: string,
    options?: Text2SqlStreamGraphOptions
  ): Promise<SqlRun> {
    return this.graphBuilder.run(
      {
        runId: input.runId,
        sessionId: input.session.id,
        question: input.question,
        datasourceId: input.session.datasource,
        datasourceType: input.datasource.type,
        modelCatalogId: input.session.modelCatalogId ?? undefined,
        contextEnvelope: input.contextEnvelope,
        accessContext: input.sqlAccessContext,
        traceContext: {
          source: "chat",
          route,
          requestId: input.requestId
        }
      },
      {
        streamMode: true,
        tools: this.sqlToolRegistry.getToolsForDatasource(input.datasource, {
          accessContext: input.sqlAccessContext
        }),
        onLlmEvent: options?.onLlmEvent,
        onStep: options?.onStep
      }
    );
  }
}
