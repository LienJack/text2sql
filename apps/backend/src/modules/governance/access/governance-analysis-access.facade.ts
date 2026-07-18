import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { WorkspaceRepository } from "../../platform/data/persistence";

@Injectable()
export class GovernanceAnalysisAccessFacade {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async assertWorkspaceRead(
    actor: Express.RequestActor,
    workspaceId: string,
    options: { hideExistence?: boolean } = {}
  ): Promise<void> {
    if (actor.isSystemAdmin || actor.principal?.roleSet.includes("system_admin")) {
      return;
    }
    const member = await this.workspaces.getWorkspaceMemberCurrent(
      actor.id,
      workspaceId
    );
    if (member) {
      return;
    }
    if (options.hideExistence) {
      throw new DomainError(
        "ANALYSIS_TASK_NOT_FOUND",
        "未找到 AnalysisTask。",
        404
      );
    }
    throw new DomainError(
      "WORKSPACE_ACCESS_DENIED",
      "当前 Principal 不属于请求的工作空间。",
      403
    );
  }
}
