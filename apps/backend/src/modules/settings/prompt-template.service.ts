import { Injectable } from "@nestjs/common";
import type {
  PromptTemplateTraceEvidence,
  SettingsActor
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { CreatePromptTemplateDto } from "./dto/create-prompt-template.dto";
import { ListPromptTemplatesQueryDto } from "./dto/list-prompt-templates.query.dto";
import { UpdatePromptTemplateDto } from "./dto/update-prompt-template.dto";

type PromptTemplateScope = "global" | "workspace" | "datasource";
type PromptTemplateScene = "sql" | "analysis";
type PromptTemplateStatus = "draft" | "active" | "archived";

type PromptTemplateRecord = {
  id: string;
  name: string;
  normalizedName: string;
  scene: PromptTemplateScene;
  scope: PromptTemplateScope;
  scopeKey: string;
  content: string;
  status: PromptTemplateStatus;
  deletedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
};

type PromptTemplateView = Omit<PromptTemplateRecord, "normalizedName">;

@Injectable()
export class PromptTemplateService {
  private readonly templates = new Map<string, PromptTemplateRecord>();

  listTemplates(query: ListPromptTemplatesQueryDto): {
    items: PromptTemplateView[];
    page: number;
    pageSize: number;
    total: number;
  } {
    const page = this.normalizePage(query.page);
    const pageSize = this.normalizePageSize(query.pageSize);
    const includeDeleted =
      query.includeDeleted === true ||
      String(query.includeDeleted).toLowerCase() === "true";
    const keyword = query.query?.trim().toLowerCase();
    const scene = query.scene ? this.normalizeScene(query.scene) : undefined;

    const filtered = Array.from(this.templates.values())
      .filter((template) => {
        if (!includeDeleted && template.deletedAt) {
          return false;
        }
        if (scene && template.scene !== scene) {
          return false;
        }
        if (query.scope && template.scope !== query.scope) {
          return false;
        }
        if (query.scopeKey && template.scopeKey !== query.scopeKey) {
          return false;
        }
        if (query.status && template.status !== query.status) {
          return false;
        }
        if (!keyword) {
          return true;
        }
        return (
          template.name.toLowerCase().includes(keyword) ||
          template.scene.toLowerCase().includes(keyword) ||
          template.scopeKey.toLowerCase().includes(keyword) ||
          template.content.toLowerCase().includes(keyword)
        );
      })
      .sort((left, right) => {
        if (left.updatedAt === right.updatedAt) {
          return right.version - left.version;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      });

    const start = (page - 1) * pageSize;
    const items = filtered
      .slice(start, start + pageSize)
      .map((template) => this.toView(template));
    return {
      items,
      page,
      pageSize,
      total: filtered.length
    };
  }

  createTemplate(
    input: CreatePromptTemplateDto,
    actor: SettingsActor | undefined
  ): { template: PromptTemplateView } {
    const normalized = this.normalizeForCreate(input);
    this.assertNoDuplicate(normalized);

    const now = new Date().toISOString();
    const template: PromptTemplateRecord = {
      id: `pt-${uuidv4()}`,
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      scene: normalized.scene,
      scope: normalized.scope,
      scopeKey: normalized.scopeKey,
      content: normalized.content,
      status: normalized.status,
      deletedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdByUserId: actor?.id ?? null,
      updatedByUserId: actor?.id ?? null
    };
    this.templates.set(template.id, template);
    return {
      template: this.toView(template)
    };
  }

  updateTemplate(
    templateId: string,
    patch: UpdatePromptTemplateDto,
    actor: SettingsActor | undefined
  ): { template: PromptTemplateView } {
    const existing = this.mustFindActiveTemplate(templateId);
    const normalized = this.normalizeForUpdate(existing, patch);
    this.assertNoDuplicate(normalized, templateId);

    const changed =
      normalized.name !== existing.name ||
      normalized.scene !== existing.scene ||
      normalized.scope !== existing.scope ||
      normalized.scopeKey !== existing.scopeKey ||
      normalized.content !== existing.content ||
      normalized.status !== existing.status;

    const updated: PromptTemplateRecord = {
      ...existing,
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      scene: normalized.scene,
      scope: normalized.scope,
      scopeKey: normalized.scopeKey,
      content: normalized.content,
      status: normalized.status,
      version: changed ? existing.version + 1 : existing.version,
      updatedAt: new Date().toISOString(),
      updatedByUserId: actor?.id ?? existing.updatedByUserId
    };
    this.templates.set(templateId, updated);
    return {
      template: this.toView(updated)
    };
  }

  softDeleteTemplate(
    templateId: string,
    actor: SettingsActor | undefined
  ): { deleted: true; templateId: string; id: string; deletedAt: string } {
    const existing = this.mustFindActiveTemplate(templateId);
    const deletedAt = new Date().toISOString();
    const deleted: PromptTemplateRecord = {
      ...existing,
      deletedAt,
      status: "archived",
      updatedAt: deletedAt,
      updatedByUserId: actor?.id ?? existing.updatedByUserId
    };
    this.templates.set(templateId, deleted);
    return {
      deleted: true,
      templateId,
      id: deleted.id,
      deletedAt
    };
  }

  async resolveSqlTemplateRuntime(input: {
    datasourceId?: string;
    workspaceId?: string;
  }): Promise<{
    template?: PromptTemplateView;
    evidence: PromptTemplateTraceEvidence;
  }> {
    const datasourceId = this.optionalTrimmed(input.datasourceId);
    const workspaceId = this.optionalTrimmed(input.workspaceId);
    const scopes: Array<{ scope: PromptTemplateScope; scopeKey: string }> = [];

    if (datasourceId) {
      scopes.push({ scope: "datasource", scopeKey: datasourceId });
    }
    if (workspaceId) {
      scopes.push({ scope: "workspace", scopeKey: workspaceId });
    }
    scopes.push({ scope: "global", scopeKey: "global" });

    for (const item of scopes) {
      const winner = Array.from(this.templates.values())
        .filter(
          (template) =>
            !template.deletedAt &&
            template.scene === "sql" &&
            template.status === "active" &&
            template.scope === item.scope &&
            template.scopeKey === item.scopeKey
        )
        .sort((left, right) => {
          if (left.updatedAt === right.updatedAt) {
            return right.version - left.version;
          }
          return right.updatedAt.localeCompare(left.updatedAt);
        })
        .at(0);
      if (!winner) {
        continue;
      }
      return {
        template: this.toView(winner),
        evidence: {
          templateId: winner.id,
          scene: winner.scene,
          scope: winner.scope,
          version: winner.version
        }
      };
    }

    return {
      evidence: {
        scene: "sql",
        scope: scopes.at(-1)?.scope ?? "global",
        fallbackReason: "template_not_found"
      }
    };
  }

  private normalizeForCreate(input: CreatePromptTemplateDto): {
    name: string;
    normalizedName: string;
    scene: PromptTemplateScene;
    scope: PromptTemplateScope;
    scopeKey: string;
    content: string;
    status: PromptTemplateStatus;
  } {
    const name = this.requireTrimmed(input.name, "name");
    const scene = this.normalizeScene(input.scene);
    const content = this.requireTrimmed(input.content, "content");
    const scope = this.normalizeScope(input.scope);
    const scopeKey = this.normalizeScopeKey(scope, input.scopeKey ?? input.scopeId);
    const status = this.normalizeStatus(input.status);
    return {
      name,
      normalizedName: name.toLowerCase(),
      scene,
      scope,
      scopeKey,
      content,
      status
    };
  }

  private normalizeForUpdate(
    existing: PromptTemplateRecord,
    patch: UpdatePromptTemplateDto
  ): {
    name: string;
    normalizedName: string;
    scene: PromptTemplateScene;
    scope: PromptTemplateScope;
    scopeKey: string;
    content: string;
    status: PromptTemplateStatus;
  } {
    const name = this.optionalTrimmed(patch.name) ?? existing.name;
    const scene = patch.scene ? this.normalizeScene(patch.scene) : existing.scene;
    const content = this.optionalTrimmed(patch.content) ?? existing.content;
    const scope = this.normalizeScope(patch.scope ?? existing.scope);
    const scopeKey = this.normalizeScopeKey(
      scope,
      patch.scopeKey ?? patch.scopeId ?? existing.scopeKey
    );
    const status = this.normalizeStatus(patch.status ?? existing.status);
    return {
      name,
      normalizedName: name.toLowerCase(),
      scene,
      scope,
      scopeKey,
      content,
      status
    };
  }

  private normalizeScene(scene: string): PromptTemplateScene {
    if (scene === "sql" || scene === "analysis") {
      return scene;
    }
    if (scene === "sql_generation") {
      return "sql";
    }
    throw new DomainError("VALIDATION_ERROR", "scene 非法。", 400, {
      scene
    });
  }

  private normalizeScope(scope: string): PromptTemplateScope {
    if (scope === "global" || scope === "workspace" || scope === "datasource") {
      return scope;
    }
    throw new DomainError("VALIDATION_ERROR", "scope 非法。", 400, {
      scope
    });
  }

  private normalizeStatus(statusRaw: string | undefined): PromptTemplateStatus {
    if (!statusRaw) {
      return "active";
    }
    if (statusRaw === "active" || statusRaw === "draft" || statusRaw === "archived") {
      return statusRaw;
    }
    if (statusRaw === "inactive") {
      return "draft";
    }
    throw new DomainError("VALIDATION_ERROR", "status 非法。", 400, {
      status: statusRaw
    });
  }

  private normalizeScopeKey(scope: PromptTemplateScope, scopeKeyRaw?: string): string {
    const scopeKey = this.optionalTrimmed(scopeKeyRaw);
    if (scope === "global") {
      return scopeKey ?? "global";
    }
    if (!scopeKey) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `scope=${scope} 时必须提供 scopeKey。`,
        400
      );
    }
    return scopeKey;
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

  private optionalTrimmed(value: string | undefined): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
  }

  private assertNoDuplicate(
    input: {
      normalizedName: string;
      scene: PromptTemplateScene;
      scope: PromptTemplateScope;
      scopeKey: string;
    },
    excludeTemplateId?: string
  ): void {
    const key = this.buildConflictKey(input);
    for (const template of this.templates.values()) {
      if (template.deletedAt) {
        continue;
      }
      if (excludeTemplateId && template.id === excludeTemplateId) {
        continue;
      }
      if (this.buildConflictKey(template) !== key) {
        continue;
      }
      throw new DomainError("PROMPT_TEMPLATE_CONFLICT", "同场景同作用域模板名称已存在。", 409, {
        scene: input.scene,
        scope: input.scope,
        scopeKey: input.scopeKey,
        name: input.normalizedName
      });
    }
  }

  private buildConflictKey(input: {
    normalizedName: string;
    scene: PromptTemplateScene;
    scope: PromptTemplateScope;
    scopeKey: string;
  }): string {
    return [input.scene, input.scope, input.scopeKey, input.normalizedName].join("::");
  }

  private mustFindActiveTemplate(templateId: string): PromptTemplateRecord {
    const normalizedId = templateId.trim();
    if (!normalizedId) {
      throw new DomainError("VALIDATION_ERROR", "templateId 不能为空。", 400);
    }
    const template = this.templates.get(normalizedId);
    if (!template || template.deletedAt) {
      throw new DomainError("PROMPT_TEMPLATE_NOT_FOUND", "模板不存在。", 404, {
        templateId: normalizedId
      });
    }
    return template;
  }

  private toView(template: PromptTemplateRecord): PromptTemplateView {
    return {
      id: template.id,
      name: template.name,
      scene: template.scene,
      scope: template.scope,
      scopeKey: template.scopeKey,
      content: template.content,
      status: template.status,
      deletedAt: template.deletedAt,
      version: template.version,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      createdByUserId: template.createdByUserId,
      updatedByUserId: template.updatedByUserId
    };
  }

  private normalizePage(page: number | undefined): number {
    if (!page || !Number.isFinite(page) || page < 1) {
      return 1;
    }
    return Math.floor(page);
  }

  private normalizePageSize(pageSize: number | undefined): number {
    if (!pageSize || !Number.isFinite(pageSize) || pageSize < 1) {
      return 20;
    }
    return Math.min(100, Math.floor(pageSize));
  }
}
