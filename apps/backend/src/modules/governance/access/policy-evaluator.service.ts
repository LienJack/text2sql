import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import {
  DatasourceAccessPolicyService,
  type AccessContext,
  type ReadableTableResolution
} from "./datasource-access-policy.service";

export type PolicyEvaluatorMode = "workspace_table_permissions";
export type PolicyEvaluatorSource = "workspace_table_permissions";

export type PolicyEvaluatorReadableResolution = ReadableTableResolution & {
  mode: PolicyEvaluatorMode;
  source: PolicyEvaluatorSource;
  allowedColumnsByTable: Record<string, string[]>;
  rowFiltersByTable: Record<string, string>;
  conflictDetected: false;
};

@Injectable()
export class PolicyEvaluatorService {
  constructor(
    private readonly accessPolicyService: DatasourceAccessPolicyService
  ) {}

  resolveAccessContext(input: {
    actor: {
      id?: string;
      role?: string;
      isSystemAdmin?: boolean;
      requestedWorkspaceId?: string;
      accessContext?: {
        actorId?: string;
        workspaceId?: string | null;
        roleSet?: string[];
      };
    };
    workspaceId?: string;
  }): Promise<AccessContext> {
    return this.accessPolicyService.resolveAccessContext(input);
  }

  async listVisibleDatasources(input: {
    context: AccessContext;
  }): Promise<{
    ids: string[];
    datasources: Datasource[];
    mode: PolicyEvaluatorMode;
    source: PolicyEvaluatorSource;
    conflictDetected: false;
  }> {
    const resolved = await this.accessPolicyService.listVisibleDatasources(input);
    return {
      ids: resolved.ids,
      datasources: resolved.datasources,
      mode: "workspace_table_permissions",
      source: "workspace_table_permissions",
      conflictDetected: false
    };
  }

  async resolveReadableTables(input: {
    context: AccessContext;
    datasourceId: string;
    candidateTables?: string[];
  }): Promise<PolicyEvaluatorReadableResolution> {
    const resolved = await this.accessPolicyService.resolveReadableTables(input);
    return {
      actorId: resolved.actorId,
      workspaceId: resolved.workspaceId,
      datasourceId: resolved.datasourceId,
      workspaceDatasourceBindingId: resolved.workspaceDatasourceBindingId,
      roleSet: [...resolved.roleSet],
      policyVersion: resolved.policyVersion,
      policyDigest: resolved.policyDigest,
      readableTables: resolved.readableTables,
      decisions: resolved.decisions,
      mode: "workspace_table_permissions",
      source: "workspace_table_permissions",
      allowedColumnsByTable: {},
      rowFiltersByTable: {},
      conflictDetected: false
    };
  }
}
