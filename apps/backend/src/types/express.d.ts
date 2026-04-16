declare namespace Express {
  type AccessRole =
    | "system_admin"
    | "workspace_admin"
    | "workspace_member"
    | "admin"
    | "member";

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
  }

  interface Request {
    requestId: string;
    actor: RequestActor;
  }
}
