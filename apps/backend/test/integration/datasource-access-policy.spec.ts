import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { DatasourceAccessPolicyService } from "../../src/modules/governance/access/datasource-access-policy.service";
import { GovernanceAccessModule } from "../../src/modules/governance/access/access.module";
import { PlatformDataPersistenceModule } from "../../src/modules/platform/data/persistence.module";
import {
  DatasourceRepository,
  WorkspaceDatasourcePolicyRepository,
  WorkspaceRepository
} from "../../src/modules/platform/data/persistence";

describe("datasource access policy service", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("resolves datasource visibility and workspace table-permission decisions", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformDataPersistenceModule, GovernanceAccessModule]
    }).compile();

    const workspaceRepository = moduleRef.get(WorkspaceRepository);
    const datasourceRepository = moduleRef.get(DatasourceRepository);
    const policyRepository = moduleRef.get(WorkspaceDatasourcePolicyRepository);
    const policyService = moduleRef.get(DatasourceAccessPolicyService);

    await workspaceRepository.upsertWorkspace({
      id: "workspace-policy-alpha",
      name: "策略空间 Alpha",
      status: "active",
      isDefault: false
    });
    await workspaceRepository.upsertWorkspaceMember({
      userId: "user-member-1",
      workspaceId: "workspace-policy-alpha",
      role: "member"
    });

    await datasourceRepository.upsertDatasource({
      id: "ds-policy-sales",
      name: "销售库",
      type: "sqlite",
      readonly: true,
      shared: true,
      status: "available"
    });
    await datasourceRepository.upsertDatasource({
      id: "ds-policy-finance",
      name: "财务库",
      type: "postgresql",
      readonly: true,
      shared: true,
      status: "available"
    });

    await policyRepository.replaceWorkspaceDatasourceBindings("workspace-policy-alpha", [
      "ds-policy-sales",
      "ds-policy-finance"
    ]);

    await policyRepository.replaceWorkspaceDatasourceTablePermissions({
      workspaceId: "workspace-policy-alpha",
      datasourceId: "ds-policy-sales",
      tableNames: ["payroll"],
      expectedPolicyVersion: 0
    });

    const accessContext = await policyService.resolveAccessContext({
      actor: {
        id: "user-member-1",
        role: "user",
        requestedWorkspaceId: "workspace-policy-alpha"
      }
    });

    expect(accessContext.workspaceId).toBe("workspace-policy-alpha");
    expect(accessContext.roleSet).toContain("workspace_member");
    expect(accessContext.roleSet).toContain("member");

    const visibility = await policyService.listVisibleDatasources({
      context: accessContext
    });
    expect(visibility.ids).toHaveLength(2);
    expect(visibility.ids).toEqual(
      expect.arrayContaining(["ds-policy-sales", "ds-policy-finance"])
    );

    const tableResolution = await policyService.resolveLegacyReadableTables({
      context: accessContext,
      datasourceId: "ds-policy-sales",
      candidateTables: ["orders", "payroll", "inventory"]
    });
    expect(tableResolution.readableTables).toEqual(["payroll"]);
    expect(tableResolution.decisions.orders).toBe("default_deny");
    expect(tableResolution.decisions.payroll).toBe("workspace_allow");
    expect(tableResolution.decisions.inventory).toBe("default_deny");
    expect(tableResolution.policySource).toBe("workspace_table_permissions");
  });

  it("rejects missing or unverified workspace context for non-admin actor", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformDataPersistenceModule, GovernanceAccessModule]
    }).compile();
    const workspaceRepository = moduleRef.get(WorkspaceRepository);
    const policyService = moduleRef.get(DatasourceAccessPolicyService);

    await workspaceRepository.upsertWorkspace({
      id: "workspace-policy-restricted",
      name: "受限空间",
      status: "active",
      isDefault: false
    });

    await expect(
      policyService.resolveAccessContext({
        actor: {
          id: "user-no-workspace",
          role: "user"
        }
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_CONTEXT_REQUIRED"
    });

    await expect(
      policyService.resolveAccessContext({
        actor: {
          id: "user-no-member",
          role: "user"
        },
        workspaceId: "workspace-policy-restricted"
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_ACCESS_DENIED"
    });
  });

  it("allows system admin to resolve workspace context without membership", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformDataPersistenceModule, GovernanceAccessModule]
    }).compile();
    const workspaceRepository = moduleRef.get(WorkspaceRepository);
    const policyService = moduleRef.get(DatasourceAccessPolicyService);

    await workspaceRepository.upsertWorkspace({
      id: "workspace-policy-admin",
      name: "管理空间",
      status: "active",
      isDefault: false
    });

    const context = await policyService.resolveAccessContext({
      actor: {
        id: "system-admin-1",
        role: "admin",
        isSystemAdmin: true
      },
      workspaceId: "workspace-policy-admin"
    });

    expect(context.workspaceId).toBe("workspace-policy-admin");
    expect(context.roleSet).toContain("system_admin");
    expect(context.roleSet).toContain("admin");
  });
});
