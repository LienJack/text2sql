import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { PolicyEvaluatorService } from "../../src/modules/governance/access/policy-evaluator.service";
import { DataModule } from "../../src/modules/data/data.module";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";
import { WorkspaceDatasourcePolicyRepository } from "../../src/modules/data/persistence/workspace-datasource-policy.repository";
import { WorkspaceRepository } from "../../src/modules/data/persistence/workspace.repository";

describe("policy evaluator service", () => {
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

  it("resolves readable tables from workspace table-permission source", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DataModule]
    }).compile();

    const workspaceRepository = moduleRef.get(WorkspaceRepository);
    const datasourceRepository = moduleRef.get(DatasourceRepository);
    const policyRepository = moduleRef.get(WorkspaceDatasourcePolicyRepository);
    const evaluatorService = moduleRef.get(PolicyEvaluatorService);

    await workspaceRepository.upsertWorkspace({
      id: "workspace-policy-evaluator-main",
      name: "策略评估器空间",
      status: "active",
      isDefault: false
    });
    await workspaceRepository.upsertWorkspaceMember({
      userId: "user-policy-evaluator-main",
      workspaceId: "workspace-policy-evaluator-main",
      role: "member"
    });
    await datasourceRepository.upsertDatasource({
      id: "ds-policy-evaluator-main",
      name: "策略评估器数据源",
      type: "sqlite",
      readonly: true,
      shared: true,
      status: "available"
    });
    await policyRepository.replaceWorkspaceDatasourceBindings(
      "workspace-policy-evaluator-main",
      ["ds-policy-evaluator-main"]
    );
    await policyRepository.replaceWorkspaceDatasourceTablePermissions({
      workspaceId: "workspace-policy-evaluator-main",
      datasourceId: "ds-policy-evaluator-main",
      tableNames: ["orders", "users"],
      expectedPolicyVersion: 0
    });

    const context = await evaluatorService.resolveAccessContext({
      actor: {
        id: "user-policy-evaluator-main",
        role: "user",
        requestedWorkspaceId: "workspace-policy-evaluator-main"
      },
      workspaceId: "workspace-policy-evaluator-main"
    });
    const resolution = await evaluatorService.resolveReadableTables({
      context,
      datasourceId: "ds-policy-evaluator-main",
      candidateTables: ["orders", "payments"]
    });

    expect(resolution.mode).toBe("workspace_table_permissions");
    expect(resolution.source).toBe("workspace_table_permissions");
    expect(resolution.readableTables).toEqual(["orders"]);
    expect(resolution.decisions.orders).toBe("workspace_allow");
    expect(resolution.decisions.payments).toBe("default_deny");
    expect(resolution.conflictDetected).toBe(false);
  });
});
