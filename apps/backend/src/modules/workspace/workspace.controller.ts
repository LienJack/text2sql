import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req
} from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../common/api-response";
import { DomainError } from "../../common/domain-error";
import { AddWorkspaceMemberDto } from "./dto/add-workspace-member.dto";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { ListWorkspaceMembersDto } from "./dto/list-workspace-members.dto";
import { RemoveWorkspaceMembersDto } from "./dto/remove-workspace-members.dto";
import { RenameWorkspaceDto } from "./dto/rename-workspace.dto";
import { UpdateWorkspaceMemberRoleDto } from "./dto/update-workspace-member-role.dto";
import { WorkspaceService } from "./workspace.service";

@Controller("/api/v1/system/workspaces")
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  async listWorkspaces(
    @Query("keyword") keyword: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.listWorkspaces(req.actor, {
        keyword
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post()
  async createWorkspace(
    @Body() body: CreateWorkspaceDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.createWorkspace(req.actor, {
        name: body.name
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Patch(":workspaceId")
  async renameWorkspace(
    @Param("workspaceId") workspaceId: string,
    @Body() body: RenameWorkspaceDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.renameWorkspace(req.actor, workspaceId, {
        name: body.name
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Delete(":workspaceId")
  async deleteWorkspace(
    @Param("workspaceId") workspaceId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.deleteWorkspace(req.actor, workspaceId);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get(":workspaceId/members")
  async listWorkspaceMembers(
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListWorkspaceMembersDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.listMembers(req.actor, workspaceId, {
        page: query.page,
        pageSize: query.pageSize,
        keyword: query.keyword
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/members")
  async addWorkspaceMember(
    @Param("workspaceId") workspaceId: string,
    @Body() body: AddWorkspaceMemberDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.addMember(req.actor, workspaceId, {
        userId: body.userId,
        role: body.role,
        displayName: body.displayName,
        account: body.account,
        email: body.email
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Patch(":workspaceId/members/:memberId/role")
  async updateWorkspaceMemberRole(
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
    @Body() body: UpdateWorkspaceMemberRoleDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.updateMemberRole(
        req.actor,
        workspaceId,
        memberId,
        {
          role: body.role
        }
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Delete(":workspaceId/members/:memberId")
  async removeWorkspaceMember(
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.removeMember(req.actor, workspaceId, memberId);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/members/remove-batch")
  async removeWorkspaceMembersBatch(
    @Param("workspaceId") workspaceId: string,
    @Body() body: RemoveWorkspaceMembersDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceService.removeMembersBatch(req.actor, workspaceId, {
        memberIds: body.memberIds
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  private toError(requestId: string, error: unknown): ApiResponse<never> {
    if (error instanceof DomainError) {
      return fail(requestId, error.code, error.message, error.details);
    }
    return fail(
      requestId,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
