import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey
} from "jose";
import { DomainError } from "../../../common/domain-error";
import {
  UserRepository,
  WorkspaceRepository
} from "../../platform/data/persistence/index";
import {
  AppConfigService,
  type AuthenticationMode
} from "../../config/app-config.service";

export type PrincipalRole =
  | "system_admin"
  | "workspace_admin"
  | "workspace_member"
  | "admin"
  | "member";

export type PrincipalTrustLevel = "verified" | "development";

export type TrustedPrincipal = {
  authenticationMethod: AuthenticationMode;
  trustLevel: PrincipalTrustLevel;
  subject: string;
  actorId: string;
  requestedWorkspaceId?: string;
  roleSet: PrincipalRole[];
  issuedAt?: string;
  expiresAt?: string;
  authPolicyVersion: string;
  digest: string;
};

type ActorResolution = {
  actor: Express.RequestActor;
  principal: TrustedPrincipal;
};

const normalizeHeader = (value: string | string[] | undefined): string | undefined => {
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim();
  return normalized || undefined;
};

const stableDigest = (value: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class TrustedPrincipalService {
  private remoteJwks?: JWTVerifyGetKey;
  private remoteJwksUrl?: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly userRepository: UserRepository,
    private readonly workspaceRepository: WorkspaceRepository
  ) {}

  async resolveRequest(request: Pick<Request, "headers">): Promise<ActorResolution> {
    if (this.config.authMode === "dev_headers") {
      return this.resolveDevelopmentHeaders(request);
    }
    return this.resolveOidcBearer(request);
  }

  private resolveDevelopmentHeaders(
    request: Pick<Request, "headers">
  ): ActorResolution {
    const requestedWorkspaceId = normalizeHeader(request.headers["x-workspace-id"]);
    const actorId =
      normalizeHeader(request.headers["x-user-id"]) ?? `anonymous-${uuidv4()}`;

    const isSystemAdmin =
      normalizeHeader(request.headers["x-user-role"])?.toLowerCase() === "admin";
    const workspaceRoles = this.parseDevelopmentWorkspaceRoles(request);
    const roleSet = new Set<PrincipalRole>();
    if (isSystemAdmin) {
      roleSet.add("system_admin");
      roleSet.add("admin");
    }
    const requestedRole = requestedWorkspaceId
      ? workspaceRoles[requestedWorkspaceId]
      : undefined;
    this.addWorkspaceRoles(roleSet, requestedRole);

    const principal = this.buildPrincipal({
      authenticationMethod: "dev_headers",
      trustLevel: "development",
      subject: actorId,
      actorId,
      requestedWorkspaceId,
      roleSet: Array.from(roleSet)
    });
    return {
      principal,
      actor: this.toRequestActor(principal, workspaceRoles)
    };
  }

  private async resolveOidcBearer(
    request: Pick<Request, "headers">
  ): Promise<ActorResolution> {
    const token = this.extractBearerToken(request.headers.authorization);
    const payload = await this.verifyBearerToken(token);
    const subject = payload.sub?.trim();
    if (!subject) {
      throw new DomainError("OIDC_SUBJECT_REQUIRED", "OIDC token 缺少 subject。", 401);
    }

    const user = await this.userRepository.getUserById(subject, {
      includeDeleted: true
    });
    if (!user || user.status !== "active" || user.deletedAt) {
      throw new DomainError(
        "PRINCIPAL_USER_INACTIVE",
        "OIDC subject 未映射到 active PlatformUser。",
        403
      );
    }

    const requestedWorkspaceId =
      normalizeHeader(request.headers["x-workspace-id"]) ?? user.defaultWorkspaceId ?? undefined;
    const roleSet = new Set<PrincipalRole>();
    if (user.isSystemAdmin) {
      roleSet.add("system_admin");
      roleSet.add("admin");
    }

    const workspaceRoles: Record<string, "admin" | "member"> = {};
    if (requestedWorkspaceId) {
      const member = await this.workspaceRepository.getWorkspaceMember(
        user.id,
        requestedWorkspaceId
      );
      if (!member && !user.isSystemAdmin) {
        throw new DomainError(
          "WORKSPACE_ACCESS_DENIED",
          "当前 Principal 不属于请求的工作空间。",
          403
        );
      }
      if (member) {
        workspaceRoles[requestedWorkspaceId] = member.role;
        this.addWorkspaceRoles(roleSet, member.role);
      }
    }

    const principal = this.buildPrincipal({
      authenticationMethod: "oidc_bearer",
      trustLevel: "verified",
      subject,
      actorId: user.id,
      requestedWorkspaceId,
      roleSet: Array.from(roleSet),
      issuedAt: this.toIsoTime(payload.iat),
      expiresAt: this.toIsoTime(payload.exp)
    });
    return {
      principal,
      actor: this.toRequestActor(principal, workspaceRoles)
    };
  }

  private async verifyBearerToken(token: string): Promise<JWTPayload> {
    try {
      const result = await jwtVerify(token, this.getRemoteJwks(), {
        issuer: this.config.authOidcIssuer,
        audience: this.config.authOidcAudience,
        algorithms: this.config.authOidcAllowedAlgorithms,
        clockTolerance: this.config.authOidcClockToleranceSeconds,
        requiredClaims: ["sub", "iat", "exp"]
      });
      return result.payload;
    } catch (error) {
      throw new DomainError(
        "OIDC_TOKEN_INVALID",
        "Bearer token 无效、已过期或不满足 issuer/audience/signature 约束。",
        401,
        {
          reason:
            error instanceof Error
              ? ((error as Error & { code?: string }).code ?? error.name)
              : "unknown"
        }
      );
    }
  }

  private getRemoteJwks(): JWTVerifyGetKey {
    const jwksUrl = this.config.authOidcJwksUrl;
    if (!this.remoteJwks || this.remoteJwksUrl !== jwksUrl) {
      this.remoteJwks = createRemoteJWKSet(new URL(jwksUrl));
      this.remoteJwksUrl = jwksUrl;
    }
    return this.remoteJwks;
  }

  private extractBearerToken(value: string | string[] | undefined): string {
    const authorization = normalizeHeader(value);
    const matched = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!matched?.[1]) {
      throw new DomainError(
        "BEARER_TOKEN_REQUIRED",
        "oidc_bearer 模式必须提供 Authorization: Bearer token。",
        401
      );
    }
    return matched[1];
  }

  private buildPrincipal(
    input: Omit<TrustedPrincipal, "authPolicyVersion" | "digest">
  ): TrustedPrincipal {
    const roleSet = [...input.roleSet].sort();
    const digestInput = {
      authenticationMethod: input.authenticationMethod,
      trustLevel: input.trustLevel,
      subject: input.subject,
      actorId: input.actorId,
      requestedWorkspaceId: input.requestedWorkspaceId ?? null,
      roleSet,
      issuedAt: input.issuedAt ?? null,
      expiresAt: input.expiresAt ?? null,
      authPolicyVersion: this.config.authPolicyVersion
    };
    return {
      ...input,
      roleSet,
      authPolicyVersion: this.config.authPolicyVersion,
      digest: stableDigest(digestInput)
    };
  }

  private toRequestActor(
    principal: TrustedPrincipal,
    workspaceRoles: Record<string, "admin" | "member">
  ): Express.RequestActor {
    const isSystemAdmin = principal.roleSet.includes("system_admin");
    return {
      id: principal.actorId,
      role: isSystemAdmin ? "admin" : "user",
      isSystemAdmin,
      workspaceRoles,
      requestedWorkspaceId: principal.requestedWorkspaceId,
      accessContext: {
        actorId: principal.actorId,
        workspaceId: principal.requestedWorkspaceId ?? null,
        roleSet: principal.roleSet
      },
      principal
    };
  }

  private parseDevelopmentWorkspaceRoles(
    request: Pick<Request, "headers">
  ): Record<string, "admin" | "member"> {
    const roles: Record<string, "admin" | "member"> = {};
    const add = (raw: string | string[] | undefined, role: "admin" | "member") => {
      const segments = (Array.isArray(raw) ? raw.join(",") : raw ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      for (const workspaceId of segments) {
        if (roles[workspaceId] !== "admin") {
          roles[workspaceId] = role;
        }
      }
    };
    add(request.headers["x-workspace-admin-ids"], "admin");
    add(request.headers["x-workspace-member-ids"], "member");

    const requestedWorkspaceId = normalizeHeader(request.headers["x-workspace-id"]);
    const requestedRole = normalizeHeader(request.headers["x-workspace-role"]);
    if (
      requestedWorkspaceId &&
      (requestedRole === "admin" || requestedRole === "member")
    ) {
      roles[requestedWorkspaceId] = requestedRole;
    }

    const jsonRoles = normalizeHeader(request.headers["x-workspace-roles"]);
    if (jsonRoles) {
      try {
        const parsed = JSON.parse(jsonRoles) as Record<string, unknown>;
        for (const [workspaceId, rawRole] of Object.entries(parsed)) {
          if (rawRole === "admin" || rawRole === "member") {
            roles[workspaceId] = rawRole;
          }
        }
      } catch {
        // Invalid development-only role JSON is ignored for compatibility.
      }
    }
    return roles;
  }

  private addWorkspaceRoles(
    roleSet: Set<PrincipalRole>,
    role: "admin" | "member" | undefined
  ): void {
    if (role === "admin") {
      roleSet.add("workspace_admin");
      roleSet.add("workspace_member");
      roleSet.add("admin");
      roleSet.add("member");
    } else if (role === "member") {
      roleSet.add("workspace_member");
      roleSet.add("member");
    }
  }

  private toIsoTime(value: number | undefined): string | undefined {
    return value === undefined ? undefined : new Date(value * 1000).toISOString();
  }
}
