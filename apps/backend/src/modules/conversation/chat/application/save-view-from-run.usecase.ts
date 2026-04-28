import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { DomainError } from "../../../../common/domain-error";
import { assertSupportedV2RunReadModel } from "../../projection/read-model/run-view-support.guard";
import { ChatRepository } from "../../../platform/data/persistence";
import { ModelingGraphRepository } from "../../../platform/data/persistence/modeling-graph.repository";
import { ModelingGraphValidator } from "../../../platform/data/persistence/modeling-graph.validator";
import type { ModelingGraphPayload, ModelingGraphView } from "../../../platform/data/persistence/modeling-graph.types";
import {
  KNOWLEDGE_MEMORY_CONTRACT,
  type KnowledgeMemoryContract,
  type SavedPriorSqlCaptureResult
} from "../../../knowledge/contracts/knowledge-memory.contract";

const VIEW_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SaveViewFromRunSavedPriorSqlDiagnostics
  extends SavedPriorSqlCaptureResult {
  message?: string;
}

export interface SaveViewFromRunInput {
  runId: string;
  name: string;
  displayName?: string;
  description?: string;
  actorId?: string;
}

export interface SaveViewFromRunResult {
  stage: "chat_run_view_saved";
  workspaceId: string;
  datasourceId: string;
  runId: string;
  replayed: boolean;
  activeRevision?: number;
  draftRevision: number;
  view: ModelingGraphView;
  savedPriorSql?: SaveViewFromRunSavedPriorSqlDiagnostics;
}

@Injectable()
export class SaveViewFromRunUsecase {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly modelingGraphRepository: ModelingGraphRepository,
    private readonly modelingGraphValidator: ModelingGraphValidator,
    @Optional()
    @Inject(KNOWLEDGE_MEMORY_CONTRACT)
    private readonly knowledgeMemoryContract?: KnowledgeMemoryContract
  ) {}

  async execute(input: SaveViewFromRunInput): Promise<SaveViewFromRunResult> {
    const runId = this.requireTrimmed(input.runId, "runId");
    const viewName = this.requireTrimmed(input.name, "name");
    if (!VIEW_NAME_PATTERN.test(viewName)) {
      throw new DomainError(
        "MODELING_VIEW_NAME_INVALID",
        "视图名称仅支持字母、数字与下划线，且必须以字母或下划线开头。",
        400,
        {
          field: "name",
          value: viewName
        }
      );
    }

    const run = await this.chatRepository.getRunById(runId);
    if (!run) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, { runId });
    }

    const session = await this.chatRepository.getSessionById(run.sessionId);
    if (!session) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, { runId });
    }
    assertSupportedV2RunReadModel(run, {
      unsupportedMessage: "该运行记录为历史兼容结构，需迁移后才能保存为视图。"
    });

    const sql = run.sql?.trim();
    if (!sql) {
      throw new DomainError(
        "RUN_SQL_NOT_AVAILABLE",
        "该运行未产出可保存的 SQL。",
        400,
        { runId }
      );
    }
    const workspaceId = this.requireTrimmed(session.workspaceId ?? "", "workspaceId");
    const datasourceId = this.requireTrimmed(session.datasource, "datasourceId");

    const current = await this.modelingGraphRepository.getLatestScopeState({
      workspaceId,
      datasourceId
    });
    const basePayload = current.draft?.graphPayload ?? this.createEmptyPayload();
    const viewId = this.buildViewId(runId);
    const existingById = basePayload.views.find((item) => item.id === viewId);
    if (existingById) {
      const savedPriorSql = await this.captureSavedPriorSql({
        workspaceId,
        datasourceId,
        run: {
          runId: run.runId,
          status: run.status,
          createdAt: run.createdAt,
          question: run.question,
          sql,
          columns: run.columns
        },
        view: existingById,
        replayed: true
      });
      return {
        stage: "chat_run_view_saved",
        workspaceId,
        datasourceId,
        runId,
        replayed: true,
        activeRevision: current.activeRevision,
        draftRevision: current.draft?.revision ?? 0,
        view: existingById,
        savedPriorSql
      };
    }

    const nameConflict = basePayload.views.find(
      (item) => item.id !== viewId && item.name.toLowerCase() === viewName.toLowerCase()
    );
    if (nameConflict) {
      throw new DomainError(
        "MODELING_VIEW_NAME_CONFLICT",
        "视图名称已存在，请更换名称后重试。",
        409,
        {
          field: "name",
          value: viewName,
          existingViewId: nameConflict.id
        }
      );
    }

    const normalizedView: ModelingGraphView = {
      id: viewId,
      name: viewName,
      sql,
      displayName: this.normalizeOptional(input.displayName) ?? viewName,
      description:
        this.normalizeOptional(input.description) ??
        this.buildDefaultDescription(runId, run.question, run.createdAt)
    };

    const nextPayload: ModelingGraphPayload = {
      models: basePayload.models,
      relationships: basePayload.relationships,
      calculatedFields: basePayload.calculatedFields,
      schemaChanges: basePayload.schemaChanges,
      views: [...basePayload.views, normalizedView].sort((left, right) =>
        left.id.localeCompare(right.id)
      )
    };
    this.modelingGraphValidator.validate(nextPayload);

    const nextRevision = await this.modelingGraphRepository.appendDraftRevision({
      workspaceId,
      datasourceId,
      graphHash: this.hashPayload(nextPayload),
      graphPayload: nextPayload,
      actorId: this.normalizeOptional(input.actorId) ?? undefined
    });
    const savedPriorSql = await this.captureSavedPriorSql({
      workspaceId,
      datasourceId,
      run: {
        runId: run.runId,
        status: run.status,
        createdAt: run.createdAt,
        question: run.question,
        sql,
        columns: run.columns
      },
      view: normalizedView,
      replayed: false
    });

    return {
      stage: "chat_run_view_saved",
      workspaceId,
      datasourceId,
      runId,
      replayed: false,
      activeRevision: current.activeRevision,
      draftRevision: nextRevision.revision,
      view: normalizedView,
      savedPriorSql
    };
  }

  private async captureSavedPriorSql(input: {
    workspaceId: string;
    datasourceId: string;
    run: {
      runId: string;
      status: string;
      createdAt: string;
      question?: string;
      sql: string;
      columns?: string[];
    };
    view: Pick<ModelingGraphView, "id" | "name" | "sql">;
    replayed: boolean;
  }): Promise<SaveViewFromRunSavedPriorSqlDiagnostics | undefined> {
    const service = this.knowledgeMemoryContract?.savedPriorSql;
    if (!service) {
      return undefined;
    }
    try {
      return await service.captureFromSavedView({
        workspaceId: input.workspaceId,
        datasourceId: input.datasourceId,
        sourceRunId: input.run.runId,
        sourceRunStatus: input.run.status,
        sourceRunCreatedAt: input.run.createdAt,
        question: this.normalizeOptional(input.run.question) ?? undefined,
        sql: input.run.sql,
        viewId: input.view.id,
        viewName: input.view.name,
        viewSql: input.view.sql,
        tableNames: [],
        columnNames: Array.isArray(input.run.columns)
          ? input.run.columns.filter(
              (column): column is string =>
                typeof column === "string" && column.trim().length > 0
            )
          : [],
        replayed: input.replayed,
        savedAt: new Date().toISOString()
      });
    } catch (error) {
      return {
        outcome: "capture_failed",
        priorId: this.safeBuildPriorId(input),
        replayKey: "saved_prior_sql:capture_failed",
        reason: "saved_prior_sql_capture_exception",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private safeBuildPriorId(input: {
    workspaceId: string;
    datasourceId: string;
    view: Pick<ModelingGraphView, "id">;
  }): string {
    const service = this.knowledgeMemoryContract?.savedPriorSql;
    if (!service) {
      return "saved_prior_sql.unavailable";
    }
    try {
      return service.buildPriorId({
        workspaceId: input.workspaceId,
        datasourceId: input.datasourceId,
        viewId: input.view.id
      });
    } catch {
      return "saved_prior_sql.unresolved";
    }
  }

  private createEmptyPayload(): ModelingGraphPayload {
    return {
      models: [],
      relationships: [],
      calculatedFields: [],
      views: [],
      schemaChanges: []
    };
  }

  private buildViewId(runId: string): string {
    return `view.chat_run.${runId}`;
  }

  private buildDefaultDescription(
    runId: string,
    question: string | undefined,
    createdAt: string
  ): string {
    const normalizedQuestion = this.normalizeOptional(question);
    if (normalizedQuestion) {
      return `Saved from chat run ${runId} (${createdAt}) · question: ${normalizedQuestion}`;
    }
    return `Saved from chat run ${runId} (${createdAt})`;
  }

  private hashPayload(payload: ModelingGraphPayload): string {
    return createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
  }

  private normalizeOptional(value: string | undefined | null): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private requireTrimmed(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", `${field} 不能为空。`, 400, {
        field
      });
    }
    return normalized;
  }
}
