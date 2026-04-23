import { DomainError } from "../../src/common/domain-error";
import { WorkspaceModelingDeployService } from "../../src/modules/governance/workspace/workspace-modeling-deploy.service";

const actor = {
  id: "user-admin",
  role: "admin" as const
};

describe("workspace modeling deploy integration", () => {
  it("blocks deploy when unresolved schema changes exist", async () => {
    const workspaceRelationshipService = {
      getDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "hash-v2",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      getDraftRevision: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "hash-v2",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      publishPrecheck: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        draftRevision: 2,
        publish_precheck_passed: true,
        blockingReasons: [],
        policyVersion: 7
      })),
      publishDraft: jest.fn(),
      rollbackDraft: jest.fn()
    };

    const workspaceDatasourceService = {
      listDatasourceTablePermissions: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 7,
        tableNames: ["orders"]
      }))
    };

    const relationshipPublishGateFacade = {
      evaluate: jest.fn(async () => ({
        pass: true,
        riskLevel: "low" as const,
        blockingReasons: [],
        dryRun: {
          pass: true,
          executedCount: 1,
          failedSamples: []
        }
      }))
    };

    const workspaceModelingService = {
      describeModelingSchemaChangeState: jest.fn(async () => ({
        highRiskStatus: "high" as const,
        unresolvedHighRiskCount: 1,
        unresolvedSchemaChangeIds: ["schema-change:deleted_column:orders:total_amount"]
      }))
    };

    const service = new WorkspaceModelingDeployService(
      workspaceRelationshipService as never,
      workspaceDatasourceService as never,
      relationshipPublishGateFacade as never,
      workspaceModelingService as never
    );

    const precheck = await service.precheck(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      draftRevision: 2
    });
    expect(precheck.pass).toBe(false);
    expect(precheck.blockingReasons).toContain("unresolved_schema_changes");
    expect(precheck.blockingReasonDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved_schema_changes",
          stage: "schema_change"
        })
      ])
    );

    await expect(
      service.deploy(actor, "ws-1", "ds-1", {
        policyVersion: 7,
        draftRevision: 2
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_MODELING_DEPLOY_BLOCKED",
      details: expect.objectContaining({
        stage: "modeling_deploy_precheck_completed",
        blockingReasons: expect.arrayContaining(["unresolved_schema_changes"]),
        blockingReasonDetails: expect.arrayContaining([
          expect.objectContaining({
            code: "unresolved_schema_changes",
            stage: "schema_change"
          })
        ])
      })
    });
  });

  it("deploys successfully when precheck and dry-run pass", async () => {
    const workspaceRelationshipService = {
      getDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "hash-v2",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      getDraftRevision: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "hash-v2",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      publishPrecheck: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        draftRevision: 2,
        publish_precheck_passed: true,
        blockingReasons: [],
        policyVersion: 7
      })),
      publishDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 2,
        graphHash: "hash-v2",
        publishGatePass: true,
        blockingReasons: []
      })),
      rollbackDraft: jest.fn()
    };

    const workspaceDatasourceService = {
      listDatasourceTablePermissions: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 7,
        tableNames: ["orders"]
      }))
    };

    const relationshipPublishGateFacade = {
      evaluate: jest.fn(async () => ({
        pass: true,
        riskLevel: "low" as const,
        blockingReasons: [],
        dryRun: {
          pass: true,
          executedCount: 2,
          failedSamples: []
        }
      }))
    };

    const workspaceModelingService = {
      describeModelingSchemaChangeState: jest.fn(async () => ({
        highRiskStatus: "low" as const,
        unresolvedHighRiskCount: 0,
        unresolvedSchemaChangeIds: []
      }))
    };

    const service = new WorkspaceModelingDeployService(
      workspaceRelationshipService as never,
      workspaceDatasourceService as never,
      relationshipPublishGateFacade as never,
      workspaceModelingService as never
    );

    const result = await service.deploy(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      draftRevision: 2,
      representativeSqlSamples: ["select count(*) from orders"]
    });
    expect(result.stage).toBe("modeling_deployed");
    expect(result.activeRevision).toBe(2);
    expect(result.blockingReasonDetails).toEqual([]);
    expect(workspaceRelationshipService.publishDraft).toHaveBeenCalledTimes(1);
  });

  it("blocks deploy for concurrent publish when draft revision is already active", async () => {
    const workspaceRelationshipService = {
      getDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 2,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "hash-v2",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      getDraftRevision: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 2,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "hash-v2",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      publishPrecheck: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        draftRevision: 2,
        publish_precheck_passed: true,
        blockingReasons: [],
        policyVersion: 7
      })),
      publishDraft: jest.fn(),
      rollbackDraft: jest.fn()
    };

    const workspaceDatasourceService = {
      listDatasourceTablePermissions: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 7,
        tableNames: ["orders"]
      }))
    };

    const relationshipPublishGateFacade = {
      evaluate: jest.fn(async () => ({
        pass: true,
        riskLevel: "low" as const,
        blockingReasons: [],
        dryRun: {
          pass: true,
          executedCount: 1,
          failedSamples: []
        }
      }))
    };

    const workspaceModelingService = {
      describeModelingSchemaChangeState: jest.fn(async () => ({
        highRiskStatus: "low" as const,
        unresolvedHighRiskCount: 0,
        unresolvedSchemaChangeIds: []
      }))
    };

    const service = new WorkspaceModelingDeployService(
      workspaceRelationshipService as never,
      workspaceDatasourceService as never,
      relationshipPublishGateFacade as never,
      workspaceModelingService as never
    );

    const precheck = await service.precheck(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      draftRevision: 2
    });
    expect(precheck.pass).toBe(false);
    expect(precheck.blockingReasons).toContain("revision_already_active");
    await expect(
      service.deploy(actor, "ws-1", "ds-1", {
        policyVersion: 7,
        draftRevision: 2
      })
    ).rejects.toBeInstanceOf(DomainError);
    expect(workspaceRelationshipService.publishDraft).not.toHaveBeenCalled();
  });

  it("blocks deploy when relationship dry-run fails even without hard blocking reasons", async () => {
    const workspaceRelationshipService = {
      getDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "hash-v2",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      getDraftRevision: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "hash-v2",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      publishPrecheck: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        draftRevision: 2,
        publish_precheck_passed: true,
        blockingReasons: [],
        policyVersion: 7
      })),
      publishDraft: jest.fn(),
      rollbackDraft: jest.fn()
    };

    const workspaceDatasourceService = {
      listDatasourceTablePermissions: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 7,
        tableNames: ["orders"]
      }))
    };

    const relationshipPublishGateFacade = {
      evaluate: jest.fn(async () => ({
        pass: true,
        riskLevel: "medium" as const,
        blockingReasons: [],
        dryRun: {
          pass: false,
          executedCount: 3,
          failedSamples: ["select * from orders where broken = 1"]
        }
      }))
    };

    const workspaceModelingService = {
      describeModelingSchemaChangeState: jest.fn(async () => ({
        highRiskStatus: "low" as const,
        unresolvedHighRiskCount: 0,
        unresolvedSchemaChangeIds: []
      }))
    };

    const service = new WorkspaceModelingDeployService(
      workspaceRelationshipService as never,
      workspaceDatasourceService as never,
      relationshipPublishGateFacade as never,
      workspaceModelingService as never
    );

    const precheck = await service.precheck(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      draftRevision: 2
    });
    expect(precheck.pass).toBe(false);
    expect(precheck.dryRun.pass).toBe(false);
    expect(precheck.blockingReasonDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dry_run_failed",
          stage: "publish_gate_dry_run"
        })
      ])
    );
    await expect(
      service.deploy(actor, "ws-1", "ds-1", {
        policyVersion: 7,
        draftRevision: 2
      })
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("uses current active revision when rollback request omits explicit target revision", async () => {
    const workspaceRelationshipService = {
      getDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 3,
        draft: {
          policyVersion: 7,
          revision: 4,
          graphHash: "hash-v4",
          edges: [],
          updatedAt: "2026-04-23T12:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      publishPrecheck: jest.fn(),
      publishDraft: jest.fn(),
      rollbackDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 3
      }))
    };

    const service = new WorkspaceModelingDeployService(
      workspaceRelationshipService as never,
      { listDatasourceTablePermissions: jest.fn() } as never,
      { evaluate: jest.fn() } as never,
      { describeModelingSchemaChangeState: jest.fn() } as never
    );

    const rollback = await service.rollback(actor, "ws-1", "ds-1", {
      policyVersion: 7
    });
    expect(rollback.stage).toBe("modeling_deploy_rolled_back");
    expect(rollback.activeRevision).toBe(3);
    expect(workspaceRelationshipService.rollbackDraft).toHaveBeenCalledWith(
      actor,
      "ws-1",
      "ds-1",
      expect.objectContaining({
        draftRevision: 3,
        rollbackToRevision: 3
      })
    );
  });
});
