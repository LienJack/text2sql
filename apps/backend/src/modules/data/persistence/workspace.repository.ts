import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type {
  ListWorkspaceMembersRequest,
  ListWorkspaceMembersResponse,
  ListWorkspacesRequest,
  ListWorkspacesResponse,
  Workspace,
  WorkspaceMember,
  WorkspaceMemberRole,
  WorkspaceStatus
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../config/app-config.service";

type PrismaClientLike = {
  workspace: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
    updateMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
  workspaceMember: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    findFirst: (args: Record<string, unknown>) => Promise<unknown>;
    deleteMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

type WorkspaceRow = {
  id: string;
  name: string;
  status: string;
  isDefault: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type WorkspaceMemberRow = {
  id: string;
  userId: string;
  workspaceId: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

type WorkspaceUpsertInput = {
  id?: string;
  name: string;
  status?: WorkspaceStatus;
  isDefault?: boolean;
  deletedAt?: string | null;
};

type WorkspaceMemberUpsertInput = {
  id?: string;
  userId: string;
  workspaceId: string;
  role?: WorkspaceMemberRole;
};

const WORKSPACE_STATUSES: ReadonlySet<string> = new Set(["active", "archived", "deleted"]);
const WORKSPACE_MEMBER_ROLES: ReadonlySet<string> = new Set(["admin", "member"]);

const toWorkspaceStatus = (value?: string | null): WorkspaceStatus => {
  if (value === "archived" || value === "deleted") {
    return value;
  }
  return "active";
};

const toWorkspaceMemberRole = (value?: string | null): WorkspaceMemberRole => {
  if (value === "admin") {
    return value;
  }
  return "member";
};

const toMembershipKey = (userId: string, workspaceId: string): string =>
  `${userId}::${workspaceId}`;

@Injectable()
export class WorkspaceRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceRepository.name);
  private prisma?: PrismaClientLike;
  private readonly workspaces = new Map<string, Workspace>();
  private readonly memberships = new Map<string, WorkspaceMember>();

  constructor(private readonly appConfig: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.isPrimaryPersistenceConfigured()) {
      return;
    }
    try {
      const prismaClientModulePath = "../../../generated/prisma/client";
      const prismaModule = (await import(prismaClientModulePath)) as unknown as {
        PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
        default?: {
          PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
        };
      };
      const adapterModule = (await import("@prisma/adapter-pg")) as unknown as {
        PrismaPg?: new (...args: unknown[]) => unknown;
        default?: {
          PrismaPg?: new (...args: unknown[]) => unknown;
        };
      };
      const PrismaCtor = prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
      const PrismaPgCtor = adapterModule.PrismaPg ?? adapterModule.default?.PrismaPg;
      if (!PrismaCtor) {
        throw new Error("PrismaClient 未生成，请先执行 prisma generate");
      }
      if (!PrismaPgCtor) {
        throw new Error("Prisma PostgreSQL adapter 未安装");
      }
      const adapter = new PrismaPgCtor({
        connectionString: this.appConfig.databaseUrl
      });
      this.prisma = new PrismaCtor({
        adapter
      }) as PrismaClientLike;
      this.logger.log("Workspace 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `Workspace 仓储初始化失败，降级为内存模式: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }

  async upsertWorkspace(input: WorkspaceUpsertInput): Promise<Workspace> {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();
    const existing = await this.getWorkspaceById(id, {
      includeDeleted: true
    });

    const workspace: Workspace = {
      id,
      name: input.name.trim() || existing?.name || id,
      status: toWorkspaceStatus(input.status ?? existing?.status),
      isDefault: input.isDefault ?? existing?.isDefault ?? false,
      deletedAt: input.deletedAt ?? existing?.deletedAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (workspace.isDefault) {
      this.demoteOtherDefaultWorkspaces(workspace.id, now);
    }

    this.workspaces.set(workspace.id, workspace);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return workspace;
    }

    await this.tryPrismaWrite(async () => {
      if (workspace.isDefault) {
        await this.prisma?.workspace.updateMany({
          where: {
            id: { not: workspace.id },
            isDefault: true
          },
          data: {
            isDefault: false,
            updatedAt: new Date(workspace.updatedAt)
          }
        });
      }

      await this.prisma?.workspace.upsert({
        where: { id: workspace.id },
        update: {
          name: workspace.name,
          status: workspace.status,
          isDefault: workspace.isDefault,
          deletedAt: workspace.deletedAt ? new Date(workspace.deletedAt) : null,
          updatedAt: new Date(workspace.updatedAt)
        },
        create: {
          id: workspace.id,
          name: workspace.name,
          status: workspace.status,
          isDefault: workspace.isDefault,
          deletedAt: workspace.deletedAt ? new Date(workspace.deletedAt) : null,
          createdAt: new Date(workspace.createdAt),
          updatedAt: new Date(workspace.updatedAt)
        }
      });
    });

    return workspace;
  }

  async listWorkspaces(options?: ListWorkspacesRequest): Promise<ListWorkspacesResponse> {
    const includeDeleted = options?.includeDeleted ?? false;
    const statuses = options?.statuses;
    const keyword = options?.keyword?.trim().toLowerCase();
    const page = Math.max(options?.page ?? 1, 1);
    const pageSize = Math.max(options?.pageSize ?? 20, 1);

    const fromMemory = this.filterAndSortWorkspaces(
      Array.from(this.workspaces.values()),
      includeDeleted,
      statuses,
      keyword
    );

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return this.paginateWorkspaces(fromMemory, page, pageSize);
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.workspace.findMany({
        where: includeDeleted ? {} : { deletedAt: null },
        orderBy: {
          updatedAt: "desc"
        }
      })
    )) as WorkspaceRow[] | null;

    if (!rows) {
      return this.paginateWorkspaces(fromMemory, page, pageSize);
    }

    const merged = new Map<string, Workspace>();
    for (const row of rows) {
      const mapped = this.fromWorkspaceRow(row);
      merged.set(mapped.id, mapped);
      this.workspaces.set(mapped.id, mapped);
    }
    for (const item of fromMemory) {
      merged.set(item.id, item);
    }

    const filtered = this.filterAndSortWorkspaces(
      Array.from(merged.values()),
      includeDeleted,
      statuses,
      keyword
    );
    return this.paginateWorkspaces(filtered, page, pageSize);
  }

  async getWorkspaceById(
    workspaceId: string,
    options?: { includeDeleted?: boolean }
  ): Promise<Workspace | undefined> {
    const includeDeleted = options?.includeDeleted ?? false;
    const memory = this.workspaces.get(workspaceId);
    if (memory) {
      if (!includeDeleted && memory.deletedAt) {
        return undefined;
      }
      return memory;
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }

    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.workspace.findUnique({
        where: { id: workspaceId }
      })
    )) as WorkspaceRow | null;
    if (!row) {
      return undefined;
    }
    const workspace = this.fromWorkspaceRow(row);
    this.workspaces.set(workspace.id, workspace);
    if (!includeDeleted && workspace.deletedAt) {
      return undefined;
    }
    return workspace;
  }

  async softDeleteWorkspace(workspaceId: string): Promise<Workspace | undefined> {
    return this.patchWorkspace(workspaceId, {
      status: "deleted",
      deletedAt: new Date().toISOString()
    });
  }

  async upsertWorkspaceMember(input: WorkspaceMemberUpsertInput): Promise<WorkspaceMember> {
    const now = new Date().toISOString();
    const role = toWorkspaceMemberRole(input.role);
    const key = toMembershipKey(input.userId, input.workspaceId);
    const existing = this.memberships.get(key);
    const member: WorkspaceMember = {
      id: existing?.id ?? input.id ?? uuidv4(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      role,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.memberships.set(key, member);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return member;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.workspaceMember.upsert({
        where: {
          userId_workspaceId: {
            userId: member.userId,
            workspaceId: member.workspaceId
          }
        },
        update: {
          role: member.role,
          updatedAt: new Date(member.updatedAt)
        },
        create: {
          id: member.id,
          userId: member.userId,
          workspaceId: member.workspaceId,
          role: member.role,
          createdAt: new Date(member.createdAt),
          updatedAt: new Date(member.updatedAt)
        }
      });
    });

    return member;
  }

  async listWorkspaceMembers(
    options: ListWorkspaceMembersRequest
  ): Promise<ListWorkspaceMembersResponse> {
    const workspaceId = options.workspaceId.trim();
    const roles = options.roles;
    const keyword = options.keyword?.trim().toLowerCase();
    const page = Math.max(options.page ?? 1, 1);
    const pageSize = Math.max(options.pageSize ?? 20, 1);

    const memory = this.filterAndSortMembers(
      Array.from(this.memberships.values()),
      workspaceId,
      roles,
      keyword
    );

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return this.paginateMembers(memory, page, pageSize);
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.workspaceMember.findMany({
        where: {
          workspaceId
        },
        orderBy: {
          updatedAt: "desc"
        }
      })
    )) as WorkspaceMemberRow[] | null;

    if (!rows) {
      return this.paginateMembers(memory, page, pageSize);
    }

    const merged = new Map<string, WorkspaceMember>();
    for (const row of rows) {
      const mapped = this.fromWorkspaceMemberRow(row);
      merged.set(toMembershipKey(mapped.userId, mapped.workspaceId), mapped);
      this.memberships.set(toMembershipKey(mapped.userId, mapped.workspaceId), mapped);
    }
    for (const item of memory) {
      merged.set(toMembershipKey(item.userId, item.workspaceId), item);
    }

    const filtered = this.filterAndSortMembers(
      Array.from(merged.values()),
      workspaceId,
      roles,
      keyword
    );
    return this.paginateMembers(filtered, page, pageSize);
  }

  async removeWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
    const key = toMembershipKey(userId, workspaceId);
    const existed = this.memberships.delete(key);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return existed;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.workspaceMember.deleteMany({
        where: {
          userId,
          workspaceId
        }
      });
    });

    return existed;
  }

  async getWorkspaceMember(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceMember | undefined> {
    const workspace = await this.getWorkspaceById(workspaceId);
    if (!workspace) {
      return undefined;
    }

    const key = toMembershipKey(userId, workspaceId);
    const memory = this.memberships.get(key);
    if (memory) {
      return memory;
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }

    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.workspaceMember.findFirst({
        where: {
          userId,
          workspaceId
        }
      })
    )) as WorkspaceMemberRow | null;

    if (!row) {
      return undefined;
    }
    const member = this.fromWorkspaceMemberRow(row);
    this.memberships.set(key, member);
    return member;
  }

  async getWorkspaceMemberCurrent(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceMember | undefined> {
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return this.memberships.get(toMembershipKey(userId, workspaceId));
    }
    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.workspaceMember.findFirst({
        where: { userId, workspaceId }
      })
    )) as WorkspaceMemberRow | null;
    const key = toMembershipKey(userId, workspaceId);
    if (!row) {
      this.memberships.delete(key);
      return undefined;
    }
    const member = this.fromWorkspaceMemberRow(row);
    this.memberships.set(key, member);
    return member;
  }

  async isWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
    const member = await this.getWorkspaceMember(userId, workspaceId);
    return member?.role === "admin";
  }

  private async patchWorkspace(
    workspaceId: string,
    patch: Partial<Workspace>
  ): Promise<Workspace | undefined> {
    const current = await this.getWorkspaceById(workspaceId, {
      includeDeleted: true
    });
    if (!current) {
      return undefined;
    }

    const next: Workspace = {
      ...current,
      ...patch,
      status: toWorkspaceStatus(patch.status ?? current.status),
      updatedAt: new Date().toISOString()
    };

    if (next.isDefault) {
      this.demoteOtherDefaultWorkspaces(next.id, next.updatedAt);
    }

    this.workspaces.set(next.id, next);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return next;
    }

    await this.tryPrismaWrite(async () => {
      if (next.isDefault) {
        await this.prisma?.workspace.updateMany({
          where: {
            id: { not: next.id },
            isDefault: true
          },
          data: {
            isDefault: false,
            updatedAt: new Date(next.updatedAt)
          }
        });
      }

      await this.prisma?.workspace.update({
        where: {
          id: next.id
        },
        data: {
          name: next.name,
          status: next.status,
          isDefault: next.isDefault,
          deletedAt: next.deletedAt ? new Date(next.deletedAt) : null,
          updatedAt: new Date(next.updatedAt)
        }
      });
    });

    return next;
  }

  private filterAndSortWorkspaces(
    workspaces: Workspace[],
    includeDeleted: boolean,
    statuses?: WorkspaceStatus[],
    keyword?: string
  ): Workspace[] {
    const normalizedStatuses = statuses?.filter((item) => WORKSPACE_STATUSES.has(item));

    const filtered = workspaces.filter((item) => {
      if (!includeDeleted && item.deletedAt) {
        return false;
      }
      if (normalizedStatuses && normalizedStatuses.length > 0 && !normalizedStatuses.includes(item.status)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return item.name.toLowerCase().includes(keyword);
    });

    return filtered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private filterAndSortMembers(
    members: WorkspaceMember[],
    workspaceId: string,
    roles?: WorkspaceMemberRole[],
    keyword?: string
  ): WorkspaceMember[] {
    const normalizedRoles = roles?.filter((item) => WORKSPACE_MEMBER_ROLES.has(item));

    const filtered = members.filter((item) => {
      if (item.workspaceId !== workspaceId) {
        return false;
      }
      if (normalizedRoles && normalizedRoles.length > 0 && !normalizedRoles.includes(item.role)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = `${item.userId} ${item.workspaceId}`.toLowerCase();
      return haystack.includes(keyword);
    });

    return filtered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private paginateWorkspaces(
    items: Workspace[],
    page: number,
    pageSize: number
  ): ListWorkspacesResponse {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return {
      items: items.slice(start, end),
      page,
      pageSize,
      total: items.length
    };
  }

  private paginateMembers(
    items: WorkspaceMember[],
    page: number,
    pageSize: number
  ): ListWorkspaceMembersResponse {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return {
      items: items.slice(start, end),
      page,
      pageSize,
      total: items.length
    };
  }

  private fromWorkspaceRow(row: WorkspaceRow): Workspace {
    return {
      id: row.id,
      name: row.name,
      status: toWorkspaceStatus(row.status),
      isDefault: row.isDefault,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private fromWorkspaceMemberRow(row: WorkspaceMemberRow): WorkspaceMember {
    return {
      id: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      role: toWorkspaceMemberRole(row.role),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private demoteOtherDefaultWorkspaces(excludeWorkspaceId: string, updatedAt: string): void {
    for (const [id, item] of this.workspaces.entries()) {
      if (id === excludeWorkspaceId || !item.isDefault) {
        continue;
      }
      this.workspaces.set(id, {
        ...item,
        isDefault: false,
        updatedAt
      });
    }
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private async tryPrismaWrite(task: () => Promise<void>): Promise<void> {
    if (!this.prisma) {
      return;
    }
    try {
      await task();
    } catch (error) {
      this.logger.warn(
        `Workspace 仓储写入 PostgreSQL 失败，保留内存数据: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async tryPrismaRead(task: () => Promise<unknown>): Promise<unknown | null> {
    if (!this.prisma) {
      return null;
    }
    try {
      return await task();
    } catch (error) {
      this.logger.warn(
        `Workspace 仓储读取 PostgreSQL 失败，回退内存数据: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
