import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../../common/domain-error";
import { ChatRepository } from "../../../platform/data/persistence";
import { ModelingGraphRepository } from "../../../platform/data/persistence/modeling-graph.repository";
import { ModelingGraphValidator } from "../../../platform/data/persistence/modeling-graph.validator";
import type { ModelingGraphPayload, ModelingGraphView } from "../../../platform/data/persistence/modeling-graph.types";

const VIEW_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
}

@Injectable()
export class SaveViewFromRunUsecase {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly modelingGraphRepository: ModelingGraphRepository,
    private readonly modelingGraphValidator: ModelingGraphValidator
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
    const sql = run.sql?.trim();
    if (!sql) {
      throw new DomainError(
        "RUN_SQL_NOT_AVAILABLE",
        "该运行未产出可保存的 SQL。",
        400,
        { runId }
      );
    }

    const session = await this.chatRepository.getSessionById(run.sessionId);
    if (!session) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, { runId });
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
      return {
        stage: "chat_run_view_saved",
        workspaceId,
        datasourceId,
        runId,
        replayed: true,
        activeRevision: current.activeRevision,
        draftRevision: current.draft?.revision ?? 0,
        view: existingById
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

    return {
      stage: "chat_run_view_saved",
      workspaceId,
      datasourceId,
      runId,
      replayed: false,
      activeRevision: current.activeRevision,
      draftRevision: nextRevision.revision,
      view: normalizedView
    };
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
