import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type { ApiResponse } from "@text2sql/shared-types";
import type { Request } from "express";
import { fail, ok } from "../../../common/api-response";
import { DomainError } from "../../../common/domain-error";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { BatchDeleteUsersDto } from "./dto/batch-delete-users.dto";
import { CreateUserDto } from "./dto/create-user.dto";
import { ListUsersDto } from "./dto/list-users.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserService } from "./user.service";

@Controller("/api/v1/system/users")
@UseGuards(AdminOnlyGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async listUsers(
    @Query() query: ListUsersDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.userService.listUsers(query);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post()
  async createUser(
    @Body() body: CreateUserDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.userService.createUser(req.actor.id, body);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Patch("/:userId")
  async updateUser(
    @Param("userId") userId: string,
    @Body() body: UpdateUserDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.userService.updateUser(req.actor.id, userId, body);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Patch("/:userId/status")
  async updateStatus(
    @Param("userId") userId: string,
    @Body() body: UpdateUserStatusDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.userService.updateStatus(req.actor.id, userId, body.status);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/:userId/reset-password")
  async resetPassword(
    @Param("userId") userId: string,
    @Body() body: ResetPasswordDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.userService.resetPassword(req.actor.id, userId, body);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Delete("/:userId")
  async deleteUser(
    @Param("userId") userId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.userService.deleteUser(userId);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/batch-delete")
  async batchDelete(
    @Body() body: BatchDeleteUsersDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.userService.deleteUsersBatch(body);
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
