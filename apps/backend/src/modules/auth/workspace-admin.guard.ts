import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { DomainError } from "../../common/domain-error";
import { WorkspaceRepository } from "../data/persistence/workspace.repository";

type RequestLike = {
  actor?: {
    id?: string;
    role?: string;
    isSystemAdmin?: boolean;
    workspaceRoles?: Record<string, "admin" | "member">;
  };
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  header?: (name: string) => string | undefined;
  headers?: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
};

const ID_KEYS = ["workspaceId", "workspaceID", "id"] as const;

const normalizeValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = normalizeValue(item);
      if (parsed) {
        return parsed;
      }
    }
  }
  return undefined;
};

@Injectable()
export class WorkspaceAdminGuard implements CanActivate {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();

    if (this.isSystemAdmin(request)) {
      return true;
    }

    const workspaceId = this.resolveWorkspaceId(request);
    if (!workspaceId) {
      throw new DomainError("FORBIDDEN", "仅系统管理员可执行该操作。", 403);
    }

    const actorId = request.actor?.id?.trim();
    if (!actorId) {
      throw new DomainError("FORBIDDEN", "仅系统管理员或工作空间管理员可执行该操作。", 403);
    }

    const roleFromActorScope = request.actor?.workspaceRoles?.[workspaceId];
    if (roleFromActorScope === "admin") {
      return true;
    }

    const hasWorkspacePermission = await this.workspaceRepository.isWorkspaceAdmin(
      actorId,
      workspaceId
    );
    if (hasWorkspacePermission) {
      return true;
    }

    throw new DomainError("FORBIDDEN", "仅系统管理员或工作空间管理员可执行该操作。", 403);
  }

  private isSystemAdmin(request: RequestLike): boolean {
    const actorRole = request.actor?.role?.toLowerCase();
    if (request.actor?.isSystemAdmin || actorRole === "admin") {
      return true;
    }
    const headerValue =
      request.header?.("x-user-role") ??
      request.headers?.["x-user-role"] ??
      request.headers?.["X-User-Role"];
    const roleFromHeader = normalizeValue(headerValue)?.toLowerCase();
    if (roleFromHeader === "admin") {
      return true;
    }
    const rawHeaders = request.rawHeaders ?? [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === "x-user-role") {
        return rawHeaders[index + 1]?.toLowerCase() === "admin";
      }
    }
    return false;
  }

  private resolveWorkspaceId(request: RequestLike): string | undefined {
    const sources = [request.params, request.body, request.query];
    for (const source of sources) {
      if (!source) {
        continue;
      }
      for (const key of ID_KEYS) {
        const parsed = normalizeValue(source[key]);
        if (parsed) {
          return parsed;
        }
      }
    }
    return undefined;
  }
}
