declare namespace Express {
  type AccessRole =
    | "system_admin"
    | "workspace_admin"
    | "workspace_member"
    | "admin"
    | "member";

  interface TrustedPrincipalContext {
    authenticationMethod: "dev_headers" | "oidc_bearer";
    trustLevel: "verified" | "development";
    subject: string;
    actorId: string;
    requestedWorkspaceId?: string;
    roleSet: AccessRole[];
    issuedAt?: string;
    expiresAt?: string;
    authPolicyVersion: string;
    digest: string;
  }

  interface RequestActor {
    id: string;
    role: "admin" | "user";
    isSystemAdmin?: boolean;
    workspaceRoles?: Record<string, "admin" | "member">;
    requestedWorkspaceId?: string;
    accessContext?: {
      actorId: string;
      workspaceId?: string | null;
      roleSet: AccessRole[];
    };
    principal?: TrustedPrincipalContext;
  }

  interface Request {
    requestId: string;
    actor: RequestActor;
  }
}
