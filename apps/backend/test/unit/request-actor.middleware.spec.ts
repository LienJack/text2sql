import type { Request, Response } from "express";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";

type RequestHeaders = Record<string, string | string[] | undefined>;

const createRequest = (headers: RequestHeaders): Request =>
  ({
    headers
  }) as unknown as Request;

describe("requestActorMiddleware", () => {
  it("keeps existing x-user-id / x-user-role compatibility", () => {
    const req = createRequest({
      "x-user-id": "user-compat-1",
      "x-user-role": "admin"
    });
    const next = jest.fn();

    requestActorMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.actor.id).toBe("user-compat-1");
    expect(req.actor.role).toBe("admin");
    expect(req.actor.isSystemAdmin).toBe(true);
    expect(req.actor.accessContext?.roleSet).toContain("system_admin");
  });

  it("parses workspace scoped headers into actor context", () => {
    const req = createRequest({
      "x-user-id": "user-workspace-1",
      "x-user-role": "user",
      "x-workspace-id": "workspace-alpha",
      "x-workspace-role": "member",
      "x-workspace-admin-ids": "workspace-beta",
      "x-workspace-member-ids": "workspace-alpha,workspace-gamma",
      "x-workspace-roles": JSON.stringify({
        "workspace-delta": "admin",
        "workspace-epsilon": "member"
      })
    });
    const next = jest.fn();

    requestActorMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.actor.requestedWorkspaceId).toBe("workspace-alpha");
    expect(req.actor.workspaceRoles).toEqual({
      "workspace-alpha": "member",
      "workspace-beta": "admin",
      "workspace-gamma": "member",
      "workspace-delta": "admin",
      "workspace-epsilon": "member"
    });
    expect(req.actor.accessContext).toEqual({
      actorId: "user-workspace-1",
      workspaceId: "workspace-alpha",
      roleSet: ["workspace_member", "member"]
    });
  });

  it("falls back to anonymous actor when user id header is missing", () => {
    const req = createRequest({
      "x-user-role": "user"
    });
    const next = jest.fn();

    requestActorMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.actor.id.startsWith("anonymous-")).toBe(true);
    expect(req.actor.role).toBe("user");
    expect(req.actor.isSystemAdmin).toBe(false);
  });
});
