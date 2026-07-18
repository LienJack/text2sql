import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type { TrustedPrincipalService } from "../governance/auth/trusted-principal.service";

type WorkspaceScopedRole = "admin" | "member";
type AccessRole =
  | "system_admin"
  | "workspace_admin"
  | "workspace_member"
  | "admin"
  | "member";

const parseHeaderSegments = (value: string | string[] | undefined): string[] => {
  if (!value) {
    return [];
  }
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const mergeWorkspaceRoles = (
  target: Record<string, WorkspaceScopedRole>,
  workspaceIds: string[],
  role: WorkspaceScopedRole
): void => {
  for (const workspaceId of workspaceIds) {
    const existing = target[workspaceId];
    if (existing === "admin") {
      continue;
    }
    target[workspaceId] = role;
  }
};

const parseWorkspaceRolesJson = (
  value: string | string[] | undefined
): Record<string, WorkspaceScopedRole> => {
  if (!value) {
    return {};
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, WorkspaceScopedRole> = {};
    for (const [workspaceId, roleValue] of Object.entries(parsed)) {
      const normalizedRole = String(roleValue).trim().toLowerCase();
      if (normalizedRole === "admin" || normalizedRole === "member") {
        result[workspaceId] = normalizedRole;
      }
    }
    return result;
  } catch {
    return {};
  }
};

export const requestActorMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const roleHeader = req.headers["x-user-role"]?.toString().toLowerCase();
  const role = roleHeader === "admin" ? "admin" : "user";
  const id = req.headers["x-user-id"]?.toString().trim() || `anonymous-${uuidv4()}`;
  const workspaceRoles: Record<string, WorkspaceScopedRole> = {};

  mergeWorkspaceRoles(
    workspaceRoles,
    parseHeaderSegments(req.headers["x-workspace-admin-ids"]),
    "admin"
  );
  mergeWorkspaceRoles(
    workspaceRoles,
    parseHeaderSegments(req.headers["x-workspace-member-ids"]),
    "member"
  );

  const requestedWorkspaceId = req.headers["x-workspace-id"]?.toString().trim();
  const singleWorkspaceRole = req.headers["x-workspace-role"]?.toString().trim().toLowerCase();
  if (
    requestedWorkspaceId &&
    (singleWorkspaceRole === "admin" || singleWorkspaceRole === "member")
  ) {
    mergeWorkspaceRoles(workspaceRoles, [requestedWorkspaceId], singleWorkspaceRole);
  }

  const scopedRolesFromJson = parseWorkspaceRolesJson(req.headers["x-workspace-roles"]);
  for (const [workspaceId, scopedRole] of Object.entries(scopedRolesFromJson)) {
    mergeWorkspaceRoles(workspaceRoles, [workspaceId], scopedRole);
  }

  const roleSet = new Set<AccessRole>();
  if (role === "admin") {
    roleSet.add("system_admin");
    roleSet.add("admin");
  }
  if (requestedWorkspaceId) {
    const scopedRole = workspaceRoles[requestedWorkspaceId];
    if (scopedRole === "admin") {
      roleSet.add("workspace_admin");
      roleSet.add("workspace_member");
      roleSet.add("admin");
      roleSet.add("member");
    } else if (scopedRole === "member") {
      roleSet.add("workspace_member");
      roleSet.add("member");
    }
  }

  req.actor = {
    id,
    role,
    isSystemAdmin: role === "admin",
    workspaceRoles,
    requestedWorkspaceId: requestedWorkspaceId || undefined,
    accessContext: {
      actorId: id,
      workspaceId: requestedWorkspaceId || null,
      roleSet: Array.from(roleSet)
    }
  };
  next();
};

export const createRequestActorMiddleware = (
  trustedPrincipalService: TrustedPrincipalService
) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const resolved = await trustedPrincipalService.resolveRequest(req);
      req.actor = resolved.actor;
      next();
    } catch (error) {
      next(error);
    }
  };
