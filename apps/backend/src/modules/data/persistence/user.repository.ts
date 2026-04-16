import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type {
  ListPlatformUsersRequest,
  ListPlatformUsersResponse,
  PlatformUser,
  PlatformUserStatus
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../config/app-config.service";

type PrismaClientLike = {
  platformUser: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
    updateMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

type PlatformUserRow = {
  id: string;
  account: string;
  name: string;
  email: string;
  status: string;
  isSystemAdmin: boolean;
  passwordHash: string | null;
  systemVariables: string | null;
  defaultWorkspaceId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserUpsertInput = {
  id?: string;
  account: string;
  name: string;
  email: string;
  status?: PlatformUserStatus;
  isSystemAdmin?: boolean;
  passwordHash?: string | null;
  systemVariables?: Record<string, unknown> | null;
  defaultWorkspaceId?: string | null;
  deletedAt?: string | null;
};

const USER_STATUSES: ReadonlySet<string> = new Set(["active", "disabled", "deleted"]);

const toPlatformUserStatus = (value?: string | null): PlatformUserStatus => {
  if (value === "disabled" || value === "deleted") {
    return value;
  }
  return "active";
};

@Injectable()
export class UserRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserRepository.name);
  private prisma?: PrismaClientLike;
  private readonly users = new Map<string, PlatformUser>();
  private readonly passwordHashes = new Map<string, string>();

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
      this.logger.log("User 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `User 仓储初始化失败，降级为内存模式: ${
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

  async upsertUser(input: UserUpsertInput): Promise<PlatformUser> {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();
    const existing = await this.getUserById(id, {
      includeDeleted: true
    });

    const normalizedStatus = toPlatformUserStatus(input.status ?? existing?.status);
    const user: PlatformUser = {
      id,
      account: input.account.trim() || existing?.account || id,
      name: input.name.trim() || existing?.name || input.account.trim() || id,
      email: input.email.trim() || existing?.email || `${id}@text2sql.local`,
      status: normalizedStatus,
      isSystemAdmin: input.isSystemAdmin ?? existing?.isSystemAdmin ?? false,
      defaultWorkspaceId: input.defaultWorkspaceId ?? existing?.defaultWorkspaceId ?? null,
      systemVariables: input.systemVariables ?? existing?.systemVariables ?? null,
      deletedAt: input.deletedAt ?? existing?.deletedAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (user.isSystemAdmin) {
      this.demoteOtherSystemAdmins(user.id, now);
    }

    this.users.set(user.id, user);
    if (input.passwordHash !== undefined) {
      if (input.passwordHash) {
        this.passwordHashes.set(user.id, input.passwordHash);
      } else {
        this.passwordHashes.delete(user.id);
      }
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return user;
    }

    await this.tryPrismaWrite(async () => {
      if (user.isSystemAdmin) {
        await this.prisma?.platformUser.updateMany({
          where: {
            id: { not: user.id },
            isSystemAdmin: true
          },
          data: {
            isSystemAdmin: false,
            updatedAt: new Date(user.updatedAt)
          }
        });
      }

      await this.prisma?.platformUser.upsert({
        where: {
          id: user.id
        },
        update: {
          account: user.account,
          name: user.name,
          email: user.email,
          status: user.status,
          isSystemAdmin: user.isSystemAdmin,
          defaultWorkspaceId: user.defaultWorkspaceId,
          systemVariables: this.serializeJson(user.systemVariables),
          passwordHash: input.passwordHash ?? undefined,
          deletedAt: user.deletedAt ? new Date(user.deletedAt) : null,
          updatedAt: new Date(user.updatedAt)
        },
        create: {
          id: user.id,
          account: user.account,
          name: user.name,
          email: user.email,
          status: user.status,
          isSystemAdmin: user.isSystemAdmin,
          defaultWorkspaceId: user.defaultWorkspaceId,
          systemVariables: this.serializeJson(user.systemVariables),
          passwordHash: input.passwordHash ?? null,
          deletedAt: user.deletedAt ? new Date(user.deletedAt) : null,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt)
        }
      });
    });

    return user;
  }

  async listUsers(options?: ListPlatformUsersRequest): Promise<ListPlatformUsersResponse> {
    const includeDeleted = options?.includeDeleted ?? false;
    const statuses = options?.statuses;
    const keyword = options?.keyword?.trim().toLowerCase();
    const page = Math.max(options?.page ?? 1, 1);
    const pageSize = Math.max(options?.pageSize ?? 20, 1);

    const fromMemory = this.filterAndSortUsers(
      Array.from(this.users.values()),
      includeDeleted,
      statuses,
      keyword
    );

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return this.paginate(fromMemory, page, pageSize);
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.platformUser.findMany({
        where: includeDeleted ? {} : { deletedAt: null },
        orderBy: {
          updatedAt: "desc"
        }
      })
    )) as PlatformUserRow[] | null;

    if (!rows) {
      return this.paginate(fromMemory, page, pageSize);
    }

    const merged = new Map<string, PlatformUser>();
    for (const row of rows) {
      const item = this.fromUserRow(row);
      merged.set(item.id, item);
      this.users.set(item.id, item);
      if (row.passwordHash) {
        this.passwordHashes.set(item.id, row.passwordHash);
      }
    }
    for (const item of fromMemory) {
      merged.set(item.id, item);
    }

    const mergedItems = this.filterAndSortUsers(
      Array.from(merged.values()),
      includeDeleted,
      statuses,
      keyword
    );
    return this.paginate(mergedItems, page, pageSize);
  }

  async getUserById(
    userId: string,
    options?: { includeDeleted?: boolean }
  ): Promise<PlatformUser | undefined> {
    const includeDeleted = options?.includeDeleted ?? false;
    const memory = this.users.get(userId);
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
      this.prisma?.platformUser.findUnique({
        where: { id: userId }
      })
    )) as PlatformUserRow | null;

    if (!row) {
      return undefined;
    }

    const user = this.fromUserRow(row);
    this.users.set(user.id, user);
    if (row.passwordHash) {
      this.passwordHashes.set(user.id, row.passwordHash);
    }
    if (!includeDeleted && user.deletedAt) {
      return undefined;
    }
    return user;
  }

  async softDeleteUser(userId: string): Promise<PlatformUser | undefined> {
    return this.patchUser(userId, {
      status: "deleted",
      deletedAt: new Date().toISOString()
    });
  }

  async getPasswordHash(userId: string): Promise<string | undefined> {
    const memory = this.passwordHashes.get(userId);
    if (memory) {
      return memory;
    }
    const user = await this.getUserById(userId, {
      includeDeleted: true
    });
    if (!user || !this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }
    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.platformUser.findUnique({
        where: { id: userId }
      })
    )) as PlatformUserRow | null;
    if (!row?.passwordHash) {
      return undefined;
    }
    this.passwordHashes.set(userId, row.passwordHash);
    return row.passwordHash;
  }

  private async patchUser(
    userId: string,
    patch: Partial<PlatformUser>
  ): Promise<PlatformUser | undefined> {
    const current = await this.getUserById(userId, {
      includeDeleted: true
    });
    if (!current) {
      return undefined;
    }

    const next: PlatformUser = {
      ...current,
      ...patch,
      status: toPlatformUserStatus(patch.status ?? current.status),
      updatedAt: new Date().toISOString()
    };

    if (next.isSystemAdmin) {
      this.demoteOtherSystemAdmins(next.id, next.updatedAt);
    }

    this.users.set(next.id, next);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return next;
    }

    await this.tryPrismaWrite(async () => {
      if (next.isSystemAdmin) {
        await this.prisma?.platformUser.updateMany({
          where: {
            id: { not: next.id },
            isSystemAdmin: true
          },
          data: {
            isSystemAdmin: false,
            updatedAt: new Date(next.updatedAt)
          }
        });
      }

      await this.prisma?.platformUser.update({
        where: { id: next.id },
        data: {
          account: next.account,
          name: next.name,
          email: next.email,
          status: next.status,
          isSystemAdmin: next.isSystemAdmin,
          defaultWorkspaceId: next.defaultWorkspaceId ?? null,
          systemVariables: this.serializeJson(next.systemVariables),
          deletedAt: next.deletedAt ? new Date(next.deletedAt) : null,
          updatedAt: new Date(next.updatedAt)
        }
      });
    });

    return next;
  }

  private filterAndSortUsers(
    users: PlatformUser[],
    includeDeleted: boolean,
    statuses?: PlatformUserStatus[],
    keyword?: string
  ): PlatformUser[] {
    const normalizedStatuses = statuses?.filter((item) => USER_STATUSES.has(item));

    const filtered = users.filter((item) => {
      if (!includeDeleted && item.deletedAt) {
        return false;
      }
      if (normalizedStatuses && normalizedStatuses.length > 0 && !normalizedStatuses.includes(item.status)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = `${item.account} ${item.name} ${item.email}`.toLowerCase();
      return haystack.includes(keyword);
    });

    return filtered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private paginate(
    items: PlatformUser[],
    page: number,
    pageSize: number
  ): ListPlatformUsersResponse {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return {
      items: items.slice(start, end),
      page,
      pageSize,
      total: items.length
    };
  }

  private fromUserRow(row: PlatformUserRow): PlatformUser {
    return {
      id: row.id,
      account: row.account,
      name: row.name,
      email: row.email,
      status: toPlatformUserStatus(row.status),
      isSystemAdmin: row.isSystemAdmin,
      defaultWorkspaceId: row.defaultWorkspaceId,
      systemVariables: this.parseJson(row.systemVariables),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private parseJson(raw: string | null): Record<string, unknown> | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private serializeJson(input?: Record<string, unknown> | null): string | null {
    if (!input) {
      return null;
    }
    return JSON.stringify(input);
  }

  private demoteOtherSystemAdmins(excludeUserId: string, updatedAt: string): void {
    for (const [id, item] of this.users.entries()) {
      if (id === excludeUserId || !item.isSystemAdmin) {
        continue;
      }
      this.users.set(id, {
        ...item,
        isSystemAdmin: false,
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
        `User 仓储写入 PostgreSQL 失败，保留内存数据: ${
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
        `User 仓储读取 PostgreSQL 失败，回退内存数据: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
