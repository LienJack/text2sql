import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload
} from "jose";
import { DomainError } from "../../src/common/domain-error";
import { AppConfigService } from "../../src/modules/config/app-config.service";
import { UserRepository } from "../../src/modules/data/persistence/user.repository";
import { WorkspaceRepository } from "../../src/modules/data/persistence/workspace.repository";
import { TrustedPrincipalService } from "../../src/modules/governance/auth/trusted-principal.service";

type TokenVerifier = {
  verifyBearerToken(token: string): Promise<JWTPayload>;
};

const createConfig = (mode: "dev_headers" | "oidc_bearer") =>
  ({
    authMode: mode,
    authPolicyVersion: "policy-test-v1",
    nodeEnv: "test"
  }) as unknown as AppConfigService;

const createService = (input?: {
  mode?: "dev_headers" | "oidc_bearer";
  user?: Record<string, unknown>;
  member?: { role: "admin" | "member" };
}) => {
  const userRepository = {
    getUserById: jest.fn().mockResolvedValue(input?.user)
  } as unknown as UserRepository;
  const workspaceRepository = {
    getWorkspaceMember: jest.fn().mockResolvedValue(input?.member)
  } as unknown as WorkspaceRepository;
  const service = new TrustedPrincipalService(
    createConfig(input?.mode ?? "dev_headers"),
    userRepository,
    workspaceRepository
  );
  return { service, userRepository, workspaceRepository };
};

describe("TrustedPrincipalService", () => {
  it("verifies signature, issuer, audience and expiry against remote JWKS", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "auth-test-key";
    publicJwk.alg = "RS256";
    const jwksServer = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));

    try {
      const address = jwksServer.address() as AddressInfo;
      const config = {
        authMode: "oidc_bearer",
        authPolicyVersion: "policy-test-v1",
        authOidcIssuer: "https://issuer.example.test",
        authOidcAudience: ["text2sql-api"],
        authOidcJwksUrl: `http://127.0.0.1:${address.port}/jwks`,
        authOidcAllowedAlgorithms: ["RS256"],
        authOidcClockToleranceSeconds: 1
      } as unknown as AppConfigService;
      const userRepository = {
        getUserById: jest.fn().mockResolvedValue({
          id: "signed-user",
          status: "active",
          deletedAt: null,
          isSystemAdmin: false,
          defaultWorkspaceId: null
        })
      } as unknown as UserRepository;
      const workspaceRepository = {} as WorkspaceRepository;
      const service = new TrustedPrincipalService(
        config,
        userRepository,
        workspaceRepository
      );
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "auth-test-key" })
        .setSubject("signed-user")
        .setIssuer("https://issuer.example.test")
        .setAudience("text2sql-api")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);

      const resolved = await service.resolveRequest({
        headers: { authorization: `Bearer ${token}` }
      });

      expect(resolved.principal).toMatchObject({
        trustLevel: "verified",
        subject: "signed-user",
        actorId: "signed-user"
      });

      const wrongAudienceToken = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "auth-test-key" })
        .setSubject("signed-user")
        .setIssuer("https://issuer.example.test")
        .setAudience("another-api")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      await expect(
        service.resolveRequest({
          headers: { authorization: `Bearer ${wrongAudienceToken}` }
        })
      ).rejects.toMatchObject<Partial<DomainError>>({
        code: "OIDC_TOKEN_INVALID",
        statusCode: 401
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        jwksServer.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("marks header actors as development-only and keeps scoped compatibility", async () => {
    const { service } = createService();

    const resolved = await service.resolveRequest({
      headers: {
        "x-user-id": "dev-admin",
        "x-user-role": "admin",
        "x-workspace-id": "workspace-a",
        "x-workspace-role": "member"
      }
    });

    expect(resolved.principal).toMatchObject({
      authenticationMethod: "dev_headers",
      trustLevel: "development",
      actorId: "dev-admin",
      requestedWorkspaceId: "workspace-a",
      authPolicyVersion: "policy-test-v1"
    });
    expect(resolved.principal.roleSet).toEqual(
      expect.arrayContaining(["system_admin", "workspace_member"])
    );
    expect(resolved.principal.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ignores forged role headers in oidc mode and loads roles from repositories", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { service, userRepository, workspaceRepository } = createService({
      mode: "oidc_bearer",
      user: {
        id: "user-oidc",
        status: "active",
        deletedAt: null,
        isSystemAdmin: false,
        defaultWorkspaceId: null
      },
      member: { role: "member" }
    });
    jest
      .spyOn(service as unknown as TokenVerifier, "verifyBearerToken")
      .mockResolvedValue({ sub: "user-oidc", iat: now, exp: now + 300 });

    const resolved = await service.resolveRequest({
      headers: {
        authorization: "Bearer signed-token",
        "x-user-role": "admin",
        "x-workspace-admin-ids": "workspace-a",
        "x-workspace-id": "workspace-a"
      }
    });

    expect(userRepository.getUserById).toHaveBeenCalledWith("user-oidc", {
      includeDeleted: true
    });
    expect(workspaceRepository.getWorkspaceMember).toHaveBeenCalledWith(
      "user-oidc",
      "workspace-a"
    );
    expect(resolved.principal.trustLevel).toBe("verified");
    expect(resolved.principal.roleSet).toEqual(["member", "workspace_member"]);
    expect(resolved.actor.isSystemAdmin).toBe(false);
  });

  it("fails closed for an inactive mapped user", async () => {
    const { service } = createService({
      mode: "oidc_bearer",
      user: {
        id: "disabled-user",
        status: "disabled",
        deletedAt: null,
        isSystemAdmin: false
      }
    });
    jest
      .spyOn(service as unknown as TokenVerifier, "verifyBearerToken")
      .mockResolvedValue({ sub: "disabled-user", iat: 1, exp: 2 });

    await expect(
      service.resolveRequest({ headers: { authorization: "Bearer token" } })
    ).rejects.toMatchObject<Partial<DomainError>>({
      code: "PRINCIPAL_USER_INACTIVE",
      statusCode: 403
    });
  });

  it("fails closed when a non-admin requests an unrelated workspace", async () => {
    const { service } = createService({
      mode: "oidc_bearer",
      user: {
        id: "workspace-outsider",
        status: "active",
        deletedAt: null,
        isSystemAdmin: false,
        defaultWorkspaceId: null
      }
    });
    jest
      .spyOn(service as unknown as TokenVerifier, "verifyBearerToken")
      .mockResolvedValue({ sub: "workspace-outsider", iat: 1, exp: 2 });

    await expect(
      service.resolveRequest({
        headers: {
          authorization: "Bearer token",
          "x-workspace-id": "workspace-private"
        }
      })
    ).rejects.toMatchObject<Partial<DomainError>>({
      code: "WORKSPACE_ACCESS_DENIED",
      statusCode: 403
    });
  });
});
