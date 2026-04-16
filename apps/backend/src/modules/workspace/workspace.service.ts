import { Injectable } from "@nestjs/common";
import type { Workspace, WorkspaceMember } from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { UserRepository } from "../data/persistence/user.repository";
import { WorkspaceRepository } from "../data/persistence/workspace.repository";

export type WorkspaceMemberRole = "admin" | "member";

type Actor = {
  id: string;
  role: "admin" | "user";
};

type WorkspaceRecord = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceMemberRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceMemberRole;
  displayName?: string;
  account?: string;
  email?: string;
  status?: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

type WorkspaceSummary = WorkspaceRecord & {
  memberCount: number;
};

type WorkspaceMemberView = WorkspaceMemberRecord;

const DEFAULT_WORKSPACE_ID = "workspace_default";
const DEFAULT_WORKSPACE_NAME = "默认工作空间";
const WORKSPACE_MEMBER_ROLES: ReadonlySet<string> = new Set(["admin", "member"]);
const PAGE_SIZE_ALL = 200;

@Injectable()
export class WorkspaceService {
  private baselineReady?: Promise<void>;

  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly userRepository: UserRepository
  ) {}

  async listWorkspaces(actor: Actor, options?: { keyword?: string }): Promise<{
    items: WorkspaceSummary[];
  }> {
    await this.ensureBaselineData();

    const keyword = options?.keyword?.trim().toLowerCase() ?? "";
    const allWorkspaces = await this.listAllWorkspaces({
      includeDeleted: false,
      keyword: keyword || undefined
    });
    const sorted = allWorkspaces
      .map((item) => this.toWorkspaceRecord(item))
      .sort((a, b) => {
        if (a.isDefault && !b.isDefault) {
          return -1;
        }
        if (!a.isDefault && b.isDefault) {
          return 1;
        }
        return a.createdAt.localeCompare(b.createdAt);
      });

    const permitted: WorkspaceRecord[] = [];
    for (const workspace of sorted) {
      if (actor.role === "admin") {
        permitted.push(workspace);
        continue;
      }
      if (await this.hasWorkspaceMembership(workspace.id, actor.id)) {
        permitted.push(workspace);
      }
    }

    const summaries = await Promise.all(
      permitted.map((workspace) => this.toWorkspaceSummary(workspace))
    );
    return {
      items: summaries
    };
  }

  async createWorkspace(actor: Actor, input: { name: string }): Promise<WorkspaceSummary> {
    await this.ensureBaselineData();
    this.assertSystemAdmin(actor);

    const name = this.normalizeWorkspaceName(input.name);
    await this.assertWorkspaceNameAvailable(name);

    const created = await this.workspaceRepository.upsertWorkspace({
      id: `workspace-${uuidv4()}`,
      name,
      status: "active",
      isDefault: false,
      deletedAt: null
    });

    return this.toWorkspaceSummary(this.toWorkspaceRecord(created));
  }

  async renameWorkspace(
    actor: Actor,
    workspaceId: string,
    input: { name: string }
  ): Promise<WorkspaceSummary> {
    await this.ensureBaselineData();
    this.assertSystemAdmin(actor);

    const workspace = await this.getWorkspaceOrThrow(workspaceId);
    const name = this.normalizeWorkspaceName(input.name);
    if (name.toLowerCase() !== workspace.name.toLowerCase()) {
      await this.assertWorkspaceNameAvailable(name, workspace.id);
    }

    const updated = await this.workspaceRepository.upsertWorkspace({
      id: workspace.id,
      name,
      status: workspace.status,
      isDefault: workspace.isDefault,
      deletedAt: workspace.deletedAt ?? null
    });
    return this.toWorkspaceSummary(this.toWorkspaceRecord(updated));
  }

  async deleteWorkspace(actor: Actor, workspaceId: string): Promise<{
    deleted: boolean;
    workspaceId: string;
    removedMemberCount: number;
    reassignedUserIds: string[];
    fallbackWorkspaceId: string;
  }> {
    await this.ensureBaselineData();
    this.assertSystemAdmin(actor);

    const workspace = await this.getWorkspaceOrThrow(workspaceId);
    if (workspace.isDefault) {
      throw new DomainError(
        "WORKSPACE_DEFAULT_PROTECTED",
        "默认工作空间不可删除。",
        400,
        {
          workspaceId
        }
      );
    }

    const fallbackWorkspace = await this.getDefaultWorkspaceOrThrow();
    const members = await this.listAllMembersByWorkspaceId(workspaceId);
    for (const member of members) {
      await this.workspaceRepository.removeWorkspaceMember(member.userId, member.workspaceId);
    }

    const reassignedUserIds: string[] = [];
    const userIdSet = new Set<string>();
    for (const member of members) {
      if (userIdSet.has(member.userId)) {
        continue;
      }
      userIdSet.add(member.userId);

      if ((await this.countMembershipsByUser(member.userId)) > 0) {
        continue;
      }

      await this.workspaceRepository.upsertWorkspaceMember({
        userId: member.userId,
        workspaceId: fallbackWorkspace.id,
        role: "member"
      });
      reassignedUserIds.push(member.userId);
    }

    await this.workspaceRepository.upsertWorkspace({
      id: workspace.id,
      name: this.buildDeletedWorkspaceName(workspace.name, workspace.id),
      status: "deleted",
      isDefault: false,
      deletedAt: new Date().toISOString()
    });

    return {
      deleted: true,
      workspaceId: workspace.id,
      removedMemberCount: members.length,
      reassignedUserIds,
      fallbackWorkspaceId: fallbackWorkspace.id
    };
  }

  async listMembers(
    actor: Actor,
    workspaceId: string,
    options?: { page?: number; pageSize?: number; keyword?: string }
  ): Promise<{
    items: WorkspaceMemberView[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
    };
  }> {
    await this.ensureBaselineData();
    await this.assertWorkspaceManagePermission(actor, workspaceId);

    const keyword = options?.keyword?.trim().toLowerCase() ?? "";
    const page = this.normalizePage(options?.page);
    const pageSize = this.normalizePageSize(options?.pageSize);
    const members = await this.listAllMembersByWorkspaceId(workspaceId);
    const views = await Promise.all(
      members.map((member) => this.toWorkspaceMemberView(member))
    );

    const filtered = views.filter((member) => {
      if (!keyword) {
        return true;
      }
      const searchText = [member.userId, member.displayName, member.account, member.email]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ")
        .toLowerCase();
      return searchText.includes(keyword);
    });

    const total = filtered.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;

    return {
      items: filtered.slice(offset, offset + pageSize),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages
      }
    };
  }

  async addMember(
    actor: Actor,
    workspaceId: string,
    input: {
      userId: string;
      role?: string;
      displayName?: string;
      account?: string;
      email?: string;
    }
  ): Promise<{
    member: WorkspaceMemberView;
    created: boolean;
  }> {
    await this.ensureBaselineData();
    await this.assertWorkspaceManagePermission(actor, workspaceId);

    const userId = input.userId.trim();
    if (!userId) {
      throw new DomainError("VALIDATION_ERROR", "成员 userId 不能为空。", 400);
    }

    const role = this.normalizeMemberRole(input.role);
    const existing = await this.findMemberByWorkspaceAndUserId(workspaceId, userId);
    const upserted = await this.workspaceRepository.upsertWorkspaceMember({
      id: existing?.id,
      userId,
      workspaceId,
      role
    });

    return {
      member: await this.toWorkspaceMemberView(upserted, {
        displayName: input.displayName,
        account: input.account,
        email: input.email
      }),
      created: !existing
    };
  }

  async updateMemberRole(
    actor: Actor,
    workspaceId: string,
    memberId: string,
    input: { role: string }
  ): Promise<{
    member: WorkspaceMemberView;
  }> {
    await this.ensureBaselineData();
    await this.assertWorkspaceManagePermission(actor, workspaceId);

    const role = this.normalizeMemberRole(input.role);
    const member = await this.getMemberOrThrow(workspaceId, memberId);
    const next = await this.workspaceRepository.upsertWorkspaceMember({
      id: member.id,
      userId: member.userId,
      workspaceId,
      role
    });

    return {
      member: await this.toWorkspaceMemberView(next)
    };
  }

  async removeMember(
    actor: Actor,
    workspaceId: string,
    memberId: string
  ): Promise<{
    removed: boolean;
    workspaceId: string;
    userId: string;
    fallbackApplied: boolean;
    fallbackWorkspaceId?: string;
  }> {
    await this.ensureBaselineData();
    await this.assertWorkspaceManagePermission(actor, workspaceId);
    return this.removeMemberWithFallback(workspaceId, memberId);
  }

  async removeMembersBatch(
    actor: Actor,
    workspaceId: string,
    input: { memberIds: string[] }
  ): Promise<{
    successCount: number;
    failedCount: number;
    failedItems: Array<{ memberId: string; code: string; message: string }>;
  }> {
    await this.ensureBaselineData();
    await this.assertWorkspaceManagePermission(actor, workspaceId);

    const ids = Array.from(
      new Set(
        input.memberIds
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      )
    );
    if (ids.length === 0) {
      throw new DomainError("VALIDATION_ERROR", "memberIds 不能为空。", 400);
    }

    let successCount = 0;
    const failedItems: Array<{ memberId: string; code: string; message: string }> = [];

    for (const memberId of ids) {
      try {
        await this.removeMemberWithFallback(workspaceId, memberId);
        successCount += 1;
      } catch (error) {
        if (error instanceof DomainError) {
          failedItems.push({
            memberId,
            code: error.code,
            message: error.message
          });
          continue;
        }
        throw error;
      }
    }

    return {
      successCount,
      failedCount: failedItems.length,
      failedItems
    };
  }

  private async removeMemberWithFallback(
    workspaceId: string,
    memberId: string
  ): Promise<{
    removed: boolean;
    workspaceId: string;
    userId: string;
    fallbackApplied: boolean;
    fallbackWorkspaceId?: string;
  }> {
    const member = await this.getMemberOrThrow(workspaceId, memberId);
    await this.workspaceRepository.removeWorkspaceMember(member.userId, workspaceId);

    let fallbackApplied = false;
    let fallbackWorkspaceId: string | undefined;
    if ((await this.countMembershipsByUser(member.userId)) === 0) {
      const fallbackWorkspace = await this.getDefaultWorkspaceOrThrow();
      if (fallbackWorkspace.id === workspaceId) {
        await this.workspaceRepository.upsertWorkspaceMember({
          id: member.id,
          userId: member.userId,
          workspaceId,
          role: member.role
        });
        throw new DomainError(
          "MEMBER_LAST_WORKSPACE_PROTECTED",
          "成员至少需要保留一个工作空间归属。",
          400,
          {
            workspaceId,
            userId: member.userId
          }
        );
      }

      await this.workspaceRepository.upsertWorkspaceMember({
        userId: member.userId,
        workspaceId: fallbackWorkspace.id,
        role: "member"
      });
      fallbackApplied = true;
      fallbackWorkspaceId = fallbackWorkspace.id;
    }

    return {
      removed: true,
      workspaceId,
      userId: member.userId,
      fallbackApplied,
      fallbackWorkspaceId
    };
  }

  private async ensureBaselineData(): Promise<void> {
    if (!this.baselineReady) {
      this.baselineReady = this.workspaceRepository.upsertWorkspace({
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
        status: "active",
        isDefault: true,
        deletedAt: null
      }).then(() => undefined);
    }
    await this.baselineReady;
  }

  private async listAllWorkspaces(options?: {
    includeDeleted?: boolean;
    keyword?: string;
  }): Promise<Workspace[]> {
    const merged = new Map<string, Workspace>();
    let page = 1;
    while (true) {
      const response = await this.workspaceRepository.listWorkspaces({
        includeDeleted: options?.includeDeleted ?? false,
        keyword: options?.keyword,
        page,
        pageSize: PAGE_SIZE_ALL
      });
      for (const item of response.items) {
        merged.set(item.id, item);
      }
      if (response.items.length === 0 || merged.size >= response.total) {
        break;
      }
      page += 1;
    }
    return Array.from(merged.values());
  }

  private async listAllMembersByWorkspaceId(workspaceId: string): Promise<WorkspaceMember[]> {
    const merged = new Map<string, WorkspaceMember>();
    let page = 1;
    while (true) {
      const response = await this.workspaceRepository.listWorkspaceMembers({
        workspaceId,
        page,
        pageSize: PAGE_SIZE_ALL
      });
      for (const item of response.items) {
        merged.set(item.id, item);
      }
      if (response.items.length === 0 || merged.size >= response.total) {
        break;
      }
      page += 1;
    }
    return Array.from(merged.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async hasWorkspaceMembership(workspaceId: string, userId: string): Promise<boolean> {
    const response = await this.workspaceRepository.listWorkspaceMembers({
      workspaceId,
      keyword: userId,
      page: 1,
      pageSize: PAGE_SIZE_ALL
    });
    return response.items.some((item) => item.userId === userId);
  }

  private async countMembershipsByUser(userId: string): Promise<number> {
    const workspaces = await this.listAllWorkspaces({
      includeDeleted: false
    });
    let count = 0;
    for (const workspace of workspaces) {
      if (await this.hasWorkspaceMembership(workspace.id, userId)) {
        count += 1;
      }
    }
    return count;
  }

  private toWorkspaceRecord(workspace: Workspace): WorkspaceRecord {
    return {
      id: workspace.id,
      name: workspace.name,
      isDefault: workspace.isDefault,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    };
  }

  private async toWorkspaceSummary(workspace: WorkspaceRecord): Promise<WorkspaceSummary> {
    const membersPage = await this.workspaceRepository.listWorkspaceMembers({
      workspaceId: workspace.id,
      page: 1,
      pageSize: 1
    });
    return {
      ...workspace,
      memberCount: membersPage.total
    };
  }

  private async toWorkspaceMemberView(
    member: WorkspaceMember,
    overrides?: {
      displayName?: string;
      account?: string;
      email?: string;
    }
  ): Promise<WorkspaceMemberView> {
    const user = await this.userRepository.getUserById(member.userId, {
      includeDeleted: true
    });
    const account = overrides?.account?.trim() || user?.account || member.userId;
    const displayName = overrides?.displayName?.trim() || user?.name || account;
    const email = overrides?.email?.trim() || user?.email || "";

    return {
      id: member.id,
      workspaceId: member.workspaceId,
      userId: member.userId,
      role: member.role,
      displayName,
      account,
      email,
      status: user?.status === "disabled" ? "disabled" : "active",
      createdAt: member.createdAt,
      updatedAt: member.updatedAt
    };
  }

  private assertSystemAdmin(actor: Actor): void {
    if (actor.role === "admin") {
      return;
    }
    throw new DomainError("FORBIDDEN", "仅系统管理员可执行该操作。", 403);
  }

  private async assertWorkspaceManagePermission(actor: Actor, workspaceId: string): Promise<void> {
    await this.getWorkspaceOrThrow(workspaceId);

    if (actor.role === "admin") {
      return;
    }

    if (await this.workspaceRepository.isWorkspaceAdmin(actor.id, workspaceId)) {
      return;
    }

    throw new DomainError(
      "FORBIDDEN",
      "仅系统管理员或当前工作空间管理员可执行该操作。",
      403,
      {
        workspaceId,
        actorId: actor.id
      }
    );
  }

  private normalizeWorkspaceName(rawName: string): string {
    const name = rawName.trim();
    if (!name) {
      throw new DomainError("VALIDATION_ERROR", "工作空间名称不能为空。", 400);
    }
    if (name.length > 64) {
      throw new DomainError("VALIDATION_ERROR", "工作空间名称长度不能超过 64。", 400);
    }
    return name;
  }

  private async assertWorkspaceNameAvailable(
    name: string,
    excludeWorkspaceId?: string
  ): Promise<void> {
    const workspaces = await this.listAllWorkspaces({
      includeDeleted: false
    });
    const normalized = name.toLowerCase();
    for (const workspace of workspaces) {
      if (excludeWorkspaceId && workspace.id === excludeWorkspaceId) {
        continue;
      }
      if (workspace.name.toLowerCase() === normalized) {
        throw new DomainError("WORKSPACE_NAME_CONFLICT", "工作空间名称已存在。", 409, {
          name
        });
      }
    }
  }

  private normalizeMemberRole(rawRole?: string): WorkspaceMemberRole {
    const role = rawRole?.toLowerCase() ?? "member";
    if (!WORKSPACE_MEMBER_ROLES.has(role)) {
      throw new DomainError("VALIDATION_ERROR", "成员角色不合法。", 400, {
        allowedRoles: ["admin", "member"]
      });
    }
    return role as WorkspaceMemberRole;
  }

  private async getWorkspaceOrThrow(workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepository.getWorkspaceById(workspaceId);
    if (!workspace) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "工作空间不存在。", 404, {
        workspaceId
      });
    }
    return workspace;
  }

  private async getDefaultWorkspaceOrThrow(): Promise<Workspace> {
    await this.ensureBaselineData();
    const workspace = await this.workspaceRepository.getWorkspaceById(DEFAULT_WORKSPACE_ID);
    if (!workspace) {
      throw new DomainError("WORKSPACE_DEFAULT_MISSING", "默认工作空间不存在。", 500);
    }
    return workspace;
  }

  private async findMemberByWorkspaceAndUserId(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMember | undefined> {
    const members = await this.listAllMembersByWorkspaceId(workspaceId);
    return members.find((member) => member.userId === userId);
  }

  private async getMemberOrThrow(
    workspaceId: string,
    memberId: string
  ): Promise<WorkspaceMember> {
    const id = memberId.trim();
    const members = await this.listAllMembersByWorkspaceId(workspaceId);
    const direct = members.find((member) => member.id === id);
    if (direct) {
      return direct;
    }

    const byUserId = members.find((member) => member.userId === id);
    if (byUserId) {
      return byUserId;
    }

    throw new DomainError("WORKSPACE_MEMBER_NOT_FOUND", "工作空间成员不存在。", 404, {
      workspaceId,
      memberId
    });
  }

  private buildDeletedWorkspaceName(name: string, workspaceId: string): string {
    return `${name}__deleted__${Date.now()}__${workspaceId.slice(0, 8)}`;
  }

  private normalizePage(value: number | undefined): number {
    if (typeof value !== "number" || Number.isNaN(value) || value < 1) {
      return 1;
    }
    return Math.floor(value);
  }

  private normalizePageSize(value: number | undefined): number {
    if (typeof value !== "number" || Number.isNaN(value) || value < 1) {
      return 20;
    }
    return Math.min(Math.floor(value), 100);
  }
}
