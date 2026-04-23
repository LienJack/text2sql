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
  pass: boolean;
  riskLevel: "low" | "medium" | "high";
  blockingReasons: string[];
  dryRun: RelationshipDryRunResult;
  schemaChange: {
    highRiskStatus: "low" | "high";
    unresolvedHighRiskCount: number;
    unresolvedSchemaChangeIds: string[];
  };
};

@Injectable()
export class WorkspaceModelingDeployService {
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
    const draft = await this.workspaceRelationshipService.getDraft(actor, workspaceId, datasourceId);
    const targetDraft =
      draft.draft?.revision === draftRevision
        ? draft.draft
        : null;
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

    const blockingReasons = new Set<string>([
      ...precheck.blockingReasons,
      ...gate.blockingReasons
    ]);
    if (schemaChangeState.highRiskStatus === "high") {
      blockingReasons.add("unresolved_schema_changes");
    }
    if (draftState.activeRevision === draftRevision) {
      blockingReasons.add("revision_already_active");
    }

    return {
      stage: "modeling_deploy_precheck_completed",
      workspaceId,
      datasourceId,
      policyVersion: precheck.policyVersion,
      draftRevision,
      activeRevision: draftState.activeRevision,
      pass: blockingReasons.size === 0 && gate.dryRun.pass,
      riskLevel:
        schemaChangeState.highRiskStatus === "high" || gate.riskLevel === "high"
          ? "high"
          : gate.riskLevel,
      blockingReasons: Array.from(blockingReasons).sort((left, right) =>
        left.localeCompare(right)
      ),
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
    graphHash: string;
    blockingReasons: string[];
    dryRun: RelationshipDryRunResult;
    riskLevel: "low" | "medium" | "high";
  }> {
    const precheck = await this.precheck(actor, workspaceId, datasourceId, body);
    if (!precheck.pass) {
      throw new DomainError(
        "WORKSPACE_MODELING_DEPLOY_BLOCKED",
        "modeling deploy 被门禁阻断。",
        409,
        {
          workspaceId,
          datasourceId,
          draftRevision: precheck.draftRevision,
          blockingReasons: precheck.blockingReasons
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
    return {
      stage: "modeling_deployed",
      workspaceId,
      datasourceId,
      activeRevision: published.activeRevision,
      graphHash: published.graphHash,
      blockingReasons: precheck.blockingReasons,
      dryRun: precheck.dryRun,
      riskLevel: precheck.riskLevel
    };
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
}
