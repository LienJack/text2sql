import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import type { RelationshipDryRunResult } from "../../platform/data/query/relationship-dry-run.service";
import { RelationshipPublishGateFacade } from "../../platform/data/query";
import { DeployModelingGraphDto } from "./dto/deploy-modeling-graph.dto";
import { WorkspaceDatasourceService } from "./workspace-datasource.service";
import { WorkspaceModelingService } from "./workspace-modeling.service";
import { WorkspaceRelationshipService } from "./workspace-relationship.service";

type Actor = {
  id: string;
  role: "admin" | "user";
  workspaceRoles?: Record<string, "admin" | "member">;
  isSystemAdmin?: boolean;
};

type ModelingDeployPrecheckResponse = {
  stage: "modeling_deploy_precheck_completed";
  workspaceId: string;
  datasourceId: string;
  policyVersion: number;
  draftRevision: number;
  activeRevision?: number;
  deployState: "undeployed" | "synced";
  pass: boolean;
  riskLevel: "low" | "medium" | "high";
  blockingReasons: string[];
  blockingReasonDetails: ModelingDeployBlockingReasonDetail[];
  dryRun: RelationshipDryRunResult;
  schemaChange: {
    highRiskStatus: "low" | "high";
    unresolvedHighRiskCount: number;
    unresolvedSchemaChangeIds: string[];
  };
};

type ModelingDeployBlockingReasonStage =
  | "publish_precheck"
  | "publish_gate_risk"
  | "publish_gate_dry_run"
  | "schema_change"
  | "deploy_state";

type ModelingDeployBlockingReasonDetail = {
  code: string;
  stage: ModelingDeployBlockingReasonStage;
  message: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class WorkspaceModelingDeployService {
  private readonly inFlightDeployScopes = new Set<string>();

  constructor(
    private readonly workspaceRelationshipService: WorkspaceRelationshipService,
    private readonly workspaceDatasourceService: WorkspaceDatasourceService,
    private readonly relationshipPublishGateFacade: RelationshipPublishGateFacade,
    private readonly workspaceModelingService: WorkspaceModelingService
  ) {}

  async precheck(
    actor: Actor,
    workspaceId: string,
    datasourceId: string,
    body: DeployModelingGraphDto
  ): Promise<ModelingDeployPrecheckResponse> {
    const draftState = await this.workspaceRelationshipService.getDraft(
      actor,
      workspaceId,
      datasourceId
    );
    if (!draftState.draft) {
      throw new DomainError(
        "WORKSPACE_MODELING_DRAFT_NOT_FOUND",
        "未找到可部署的 modeling draft。",
        404,
        {
          workspaceId,
          datasourceId
        }
      );
    }
    const draftRevision = body.draftRevision ?? draftState.draft.revision;
    const tablePermissionSet = await this.workspaceDatasourceService.listDatasourceTablePermissions(
      actor,
      workspaceId,
      datasourceId
    );
    const precheck = await this.workspaceRelationshipService.publishPrecheck(
      actor,
      workspaceId,
      datasourceId,
      {
        policyVersion: body.policyVersion,
        draftRevision,
        representativeSqlSamples: body.representativeSqlSamples
      }
    );
    const targetDraftState = await this.workspaceRelationshipService.getDraftRevision(
      actor,
      workspaceId,
      datasourceId,
      draftRevision
    );
    const targetDraft = targetDraftState.draft;
    if (!targetDraft) {
      throw new DomainError(
        "WORKSPACE_MODELING_DRAFT_NOT_FOUND",
        "未找到可部署的 modeling draft。",
        404,
        {
          workspaceId,
          datasourceId,
          draftRevision
        }
      );
    }
    const gate = await this.relationshipPublishGateFacade.evaluate({
      datasourceId,
      edges: targetDraft.edges,
      representativeSqlSamples: body.representativeSqlSamples ?? [],
      allowedTables: tablePermissionSet.tableNames,
      accessContext: {
        actorId: actor.id,
        workspaceId,
        roleSet: actor.role === "admin" || actor.isSystemAdmin ? ["admin"] : ["member"]
      }
    });
    const schemaChangeState = await this.workspaceModelingService.describeModelingSchemaChangeState(
      actor,
      workspaceId,
      datasourceId
    );

    const gateBlockingReasons = new Set(gate.blockingReasons);
    if (!gate.dryRun.pass) {
      gateBlockingReasons.add("dry_run_failed");
    }
    const blockingReasons = new Set<string>([
      ...precheck.blockingReasons,
      ...gateBlockingReasons
    ]);
    const deployState =
      targetDraftState.activeRevision === draftRevision ? "synced" : "undeployed";
    if (schemaChangeState.highRiskStatus === "high") {
      blockingReasons.add("unresolved_schema_changes");
    }
    if (deployState === "synced") {
      blockingReasons.add("revision_already_active");
    }
    const blockingReasonDetails = this.buildBlockingReasonDetails({
      precheckBlockingReasons: precheck.blockingReasons,
      gateBlockingReasons: Array.from(gateBlockingReasons),
      dryRun: gate.dryRun,
      schemaChangeState,
      activeRevision: targetDraftState.activeRevision,
      draftRevision
    });

    return {
      stage: "modeling_deploy_precheck_completed",
      workspaceId,
      datasourceId,
      policyVersion: precheck.policyVersion,
      draftRevision,
      activeRevision: targetDraftState.activeRevision,
      deployState,
      pass: blockingReasons.size === 0 && gate.dryRun.pass,
      riskLevel:
        schemaChangeState.highRiskStatus === "high" || gate.riskLevel === "high"
          ? "high"
          : gate.riskLevel,
      blockingReasons: Array.from(blockingReasons).sort((left, right) =>
        left.localeCompare(right)
      ),
      blockingReasonDetails,
      dryRun: gate.dryRun,
      schemaChange: {
        highRiskStatus: schemaChangeState.highRiskStatus,
        unresolvedHighRiskCount: schemaChangeState.unresolvedHighRiskCount,
        unresolvedSchemaChangeIds: schemaChangeState.unresolvedSchemaChangeIds
      }
    };
  }

  async deploy(
    actor: Actor,
    workspaceId: string,
    datasourceId: string,
    body: DeployModelingGraphDto
  ): Promise<{
    stage: "modeling_deployed";
    workspaceId: string;
    datasourceId: string;
    activeRevision: number;
    deployState: "synced";
    graphHash: string;
    blockingReasons: string[];
    blockingReasonDetails: ModelingDeployBlockingReasonDetail[];
    dryRun: RelationshipDryRunResult;
    riskLevel: "low" | "medium" | "high";
  }> {
    const deployScope = this.buildDeployScope(workspaceId, datasourceId);
    if (this.inFlightDeployScopes.has(deployScope)) {
      throw new DomainError(
        "WORKSPACE_MODELING_DEPLOY_IN_PROGRESS",
        "相同数据源的 deploy 正在进行中，请稍后重试。",
        409,
        {
          workspaceId,
          datasourceId,
          blockingReasons: ["deploy_in_progress"],
          blockingReasonDetails: [
            {
              code: "deploy_in_progress",
              stage: "deploy_state",
              message: "已有 deploy 流程在执行。",
              metadata: {
                workspaceId,
                datasourceId
              }
            }
          ]
        }
      );
    }

    this.inFlightDeployScopes.add(deployScope);
    try {
      const precheck = await this.precheck(actor, workspaceId, datasourceId, body);
      if (!precheck.pass) {
        throw new DomainError(
          "WORKSPACE_MODELING_DEPLOY_BLOCKED",
          "modeling deploy 被门禁阻断。",
          409,
          {
            workspaceId,
            datasourceId,
            stage: precheck.stage,
            draftRevision: precheck.draftRevision,
            deployState: precheck.deployState,
            blockingReasons: precheck.blockingReasons,
            blockingReasonDetails: precheck.blockingReasonDetails
          }
        );
      }
      const published = await this.workspaceRelationshipService.publishDraft(
        actor,
        workspaceId,
        datasourceId,
        {
          policyVersion: precheck.policyVersion,
          draftRevision: precheck.draftRevision,
          representativeSqlSamples: body.representativeSqlSamples
        }
      );
      if (published.activeRevision !== precheck.draftRevision) {
        throw new DomainError(
          "WORKSPACE_MODELING_DEPLOY_ACTIVE_REVISION_MISMATCH",
          "deploy 完成后 active revision 与预期不一致。",
          409,
          {
            workspaceId,
            datasourceId,
            expectedActiveRevision: precheck.draftRevision,
            actualActiveRevision: published.activeRevision
          }
        );
      }
      return {
        stage: "modeling_deployed",
        workspaceId,
        datasourceId,
        activeRevision: published.activeRevision,
        deployState: "synced",
        graphHash: published.graphHash,
        blockingReasons: precheck.blockingReasons,
        blockingReasonDetails: precheck.blockingReasonDetails,
        dryRun: precheck.dryRun,
        riskLevel: precheck.riskLevel
      };
    } finally {
      this.inFlightDeployScopes.delete(deployScope);
    }
  }

  async rollback(
    actor: Actor,
    workspaceId: string,
    datasourceId: string,
    body: DeployModelingGraphDto
  ): Promise<{
    stage: "modeling_deploy_rolled_back";
    workspaceId: string;
    datasourceId: string;
    activeRevision: number;
  }> {
    const current = await this.workspaceRelationshipService.getDraft(
      actor,
      workspaceId,
      datasourceId
    );
    const targetRevision = body.rollbackToRevision ?? body.draftRevision ?? current.activeRevision;
    if (!targetRevision) {
      throw new DomainError("VALIDATION_ERROR", "rollback revision 不能为空。", 400, {
        field: "rollbackToRevision"
      });
    }
    const rolledBack = await this.workspaceRelationshipService.rollbackDraft(
      actor,
      workspaceId,
      datasourceId,
      {
        policyVersion: body.policyVersion,
        draftRevision: targetRevision,
        rollbackToRevision: targetRevision
      }
    );
    return {
      stage: "modeling_deploy_rolled_back",
      workspaceId,
      datasourceId,
      activeRevision: rolledBack.activeRevision
    };
  }

  private buildDeployScope(workspaceId: string, datasourceId: string): string {
    return `${workspaceId.trim()}::${datasourceId.trim()}`;
  }

  private buildBlockingReasonDetails(input: {
    precheckBlockingReasons: string[];
    gateBlockingReasons: string[];
    dryRun: RelationshipDryRunResult;
    schemaChangeState: {
      highRiskStatus: "low" | "high";
      unresolvedHighRiskCount: number;
      unresolvedSchemaChangeIds: string[];
    };
    activeRevision?: number;
    draftRevision: number;
  }): ModelingDeployBlockingReasonDetail[] {
    const details = new Map<string, ModelingDeployBlockingReasonDetail>();
    const saveDetail = (
      code: string,
      stage: ModelingDeployBlockingReasonStage,
      message: string,
      metadata?: Record<string, unknown>
    ): void => {
      const key = `${stage}:${code}`;
      if (details.has(key)) {
        return;
      }
      details.set(key, {
        code,
        stage,
        message,
        metadata
      });
    };

    for (const code of input.precheckBlockingReasons) {
      saveDetail(code, "publish_precheck", "发布前置校验未通过。");
    }
    for (const code of input.gateBlockingReasons) {
      if (code === "dry_run_failed") {
        saveDetail(code, "publish_gate_dry_run", "dry-run SQL 样本校验失败。", {
          executedCount: input.dryRun.executedCount,
          failedSampleCount: input.dryRun.failedSamples.length
        });
        continue;
      }
      saveDetail(code, "publish_gate_risk", "relationship 门禁风险评估触发阻断。");
    }
    if (input.schemaChangeState.highRiskStatus === "high") {
      saveDetail("unresolved_schema_changes", "schema_change", "存在未解决的高风险 schema change。", {
        unresolvedHighRiskCount: input.schemaChangeState.unresolvedHighRiskCount,
        unresolvedSchemaChangeIds: input.schemaChangeState.unresolvedSchemaChangeIds
      });
    }
    if (input.activeRevision === input.draftRevision) {
      saveDetail("revision_already_active", "deploy_state", "目标 revision 已是当前 active revision。", {
        activeRevision: input.activeRevision,
        draftRevision: input.draftRevision
      });
    }

    return Array.from(details.values()).sort((left, right) => {
      const codeCompare = left.code.localeCompare(right.code);
      return codeCompare !== 0 ? codeCompare : left.stage.localeCompare(right.stage);
    });
  }
}
