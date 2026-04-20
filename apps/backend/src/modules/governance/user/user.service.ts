import { Injectable } from "@nestjs/common";
import type { PlatformUser, PlatformUserStatus } from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../common/domain-error";
import {
  UserRepository,
  WorkspaceRepository
} from "../../platform/data/persistence/index";
import { BatchDeleteUsersDto } from "./dto/batch-delete-users.dto";
import { CreateUserDto } from "./dto/create-user.dto";
import { ListUsersDto } from "./dto/list-users.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserVariableDto } from "./dto/user-variable.dto";

export type UserStatus = "active" | "disabled";

type UserVariable = {
  key: string;
  value: string;
};

type UserView = {
  id: string;
  account: string;
  name: string;
  email: string;
  status: UserStatus;
  workspaceIds: string[];
  variables: UserVariable[];
  createdAt: string;
  updatedAt: string;
  lastPasswordResetAt: string | null;
  isSystemAdmin: boolean;
};

type BatchDeleteFailedItem = {
  userId: string;
  code: string;
  message: string;
};

type BatchDeleteResult = {
  successCount: number;
  failedCount: number;
  failedItems: BatchDeleteFailedItem[];
};

type ListUsersResult = {
  items: UserView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: {
    keyword?: string;
    status?: UserStatus;
    workspaceId?: string;
  };
};

type UserServiceMeta = {
  workspaceIds: string[];
  lastPasswordResetAt: string | null;
};

const USER_SERVICE_META_KEY = "__userServiceMeta";
const PAGE_SIZE_ALL = 200;

@Injectable()
export class UserService {
  private readonly defaultWorkspaceId = "workspace_default";
  private readonly defaultWorkspaceName = "默认工作空间";
  private readonly defaultAdminAccount = "admin";
  private readonly defaultAdminId = "user_system_admin";
  private baselineReady?: Promise<void>;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly workspaceRepository: WorkspaceRepository
  ) {}

  async listUsers(query: ListUsersDto): Promise<ListUsersResult> {
    await this.ensureBaselineData();

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const keyword = query.keyword?.trim().toLowerCase();
    const status = query.status;
    const workspaceId = query.workspaceId?.trim();

    const filtered = (await this.listAllUsers({
      includeDeleted: false,
      keyword,
      statuses: status ? [status] : undefined
    }))
      .filter((user) => {
        if (!workspaceId) {
          return true;
        }
        return this.readWorkspaceIds(user).includes(workspaceId);
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    const total = filtered.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = filtered.slice(start, end).map((user) => this.toView(user));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
      filters: {
        keyword: query.keyword?.trim() || undefined,
        status,
        workspaceId
      }
    };
  }

  async createUser(_actorId: string, input: CreateUserDto): Promise<UserView> {
    await this.ensureBaselineData();

    const account = this.normalizeAccount(input.account);
    const email = this.normalizeEmail(input.email);
    await this.assertUniqueAccount(account);
    await this.assertUniqueEmail(email);

    const userId = `user-${uuidv4()}`;
    const workspaceIds = this.normalizeWorkspaceIds(input.workspaceIds);
    const variables = this.normalizeVariables(input.variables);
    const created = await this.userRepository.upsertUser({
      id: userId,
      account,
      name: input.name.trim(),
      email,
      status: input.status ?? "active",
      isSystemAdmin: false,
      defaultWorkspaceId: workspaceIds[0] ?? this.defaultWorkspaceId,
      systemVariables: this.buildSystemVariables(variables, {
        workspaceIds,
        lastPasswordResetAt: null
      }),
      passwordHash: this.buildInitialPassword(),
      deletedAt: null
    });

    await this.syncUserWorkspaceMemberships(userId, workspaceIds, []);
    return this.toView(created);
  }

  async updateUser(_actorId: string, userId: string, input: UpdateUserDto): Promise<UserView> {
    await this.ensureBaselineData();

    const user = await this.getUserOrThrow(userId);
    if (input.account && this.normalizeAccount(input.account) !== user.account) {
      throw new DomainError("ACCOUNT_IMMUTABLE", "用户账号创建后不可修改。", 400, {
        userId
      });
    }

    const previousWorkspaceIds = this.readWorkspaceIds(user);
    const nextWorkspaceIds = input.workspaceIds
      ? this.normalizeWorkspaceIds(input.workspaceIds)
      : previousWorkspaceIds;
    const nextVariables = input.variables
      ? this.normalizeVariables(input.variables)
      : this.readUserVariables(user.systemVariables);
    const meta = this.readServiceMeta(user.systemVariables);

    let nextEmail = user.email;
    if (input.email) {
      nextEmail = this.normalizeEmail(input.email);
      await this.assertUniqueEmail(nextEmail, user.id);
    }

    const updated = await this.userRepository.upsertUser({
      id: user.id,
      account: user.account,
      name: typeof input.name === "string" ? input.name.trim() : user.name,
      email: nextEmail,
      status: input.status ?? (user.status === "disabled" ? "disabled" : "active"),
      isSystemAdmin: user.isSystemAdmin,
      defaultWorkspaceId: nextWorkspaceIds[0] ?? this.defaultWorkspaceId,
      systemVariables: this.buildSystemVariables(nextVariables, {
        workspaceIds: nextWorkspaceIds,
        lastPasswordResetAt: meta.lastPasswordResetAt
      }),
      deletedAt: null
    });

    await this.syncUserWorkspaceMemberships(user.id, nextWorkspaceIds, previousWorkspaceIds);
    return this.toView(updated);
  }

  async updateStatus(_actorId: string, userId: string, status: UserStatus): Promise<UserView> {
    await this.ensureBaselineData();

    const user = await this.getUserOrThrow(userId);
    const updated = await this.userRepository.upsertUser({
      id: user.id,
      account: user.account,
      name: user.name,
      email: user.email,
      status,
      isSystemAdmin: user.isSystemAdmin,
      defaultWorkspaceId: user.defaultWorkspaceId ?? this.defaultWorkspaceId,
      systemVariables: user.systemVariables ?? null,
      deletedAt: null
    });
    return this.toView(updated);
  }

  async resetPassword(
    _actorId: string,
    userId: string,
    input?: ResetPasswordDto
  ): Promise<{
    userId: string;
    account: string;
    temporaryPassword: string;
    resetAt: string;
  }> {
    await this.ensureBaselineData();

    const user = await this.getUserOrThrow(userId);
    const temporaryPassword = input?.defaultPassword?.trim() || this.buildTemporaryPassword();
    const resetAt = new Date().toISOString();
    const variables = this.readUserVariables(user.systemVariables);

    await this.userRepository.upsertUser({
      id: user.id,
      account: user.account,
      name: user.name,
      email: user.email,
      status: user.status === "disabled" ? "disabled" : "active",
      isSystemAdmin: user.isSystemAdmin,
      defaultWorkspaceId: user.defaultWorkspaceId ?? this.defaultWorkspaceId,
      systemVariables: this.buildSystemVariables(variables, {
        workspaceIds: this.readWorkspaceIds(user),
        lastPasswordResetAt: resetAt
      }),
      passwordHash: temporaryPassword,
      deletedAt: null
    });

    return {
      userId,
      account: user.account,
      temporaryPassword,
      resetAt
    };
  }

  async deleteUser(userId: string): Promise<{ deleted: true; userId: string }> {
    await this.ensureBaselineData();

    const user = await this.getUserOrThrow(userId);
    if (this.isDefaultAdmin(user)) {
      throw new DomainError(
        "DEFAULT_ADMIN_PROTECTED",
        "默认管理员账号不可删除。",
        400,
        {
          userId
        }
      );
    }
    await this.archiveUser(user);
    return {
      deleted: true,
      userId: user.id
    };
  }

  async deleteUsersBatch(input: BatchDeleteUsersDto): Promise<BatchDeleteResult> {
    await this.ensureBaselineData();

    let successCount = 0;
    const failedItems: BatchDeleteFailedItem[] = [];

    for (const userId of input.userIds) {
      const user = await this.userRepository.getUserById(userId);
      if (!user) {
        failedItems.push({
          userId,
          code: "USER_NOT_FOUND",
          message: "用户不存在。"
        });
        continue;
      }
      if (this.isDefaultAdmin(user)) {
        failedItems.push({
          userId,
          code: "DEFAULT_ADMIN_PROTECTED",
          message: "默认管理员账号不可删除。"
        });
        continue;
      }
      await this.archiveUser(user);
      successCount += 1;
    }

    return {
      successCount,
      failedCount: failedItems.length,
      failedItems
    };
  }

  private async ensureBaselineData(): Promise<void> {
    if (!this.baselineReady) {
      this.baselineReady = this.seedBaselineData();
    }
    await this.baselineReady;
  }

  private async seedBaselineData(): Promise<void> {
    await this.workspaceRepository.upsertWorkspace({
      id: this.defaultWorkspaceId,
      name: this.defaultWorkspaceName,
      status: "active",
      isDefault: true,
      deletedAt: null
    });

    const existingAdmin = await this.findUserByAccount(this.defaultAdminAccount, {
      includeDeleted: true
    });
    const adminId = existingAdmin?.id ?? this.defaultAdminId;
    const adminVariables = this.readUserVariables(existingAdmin?.systemVariables);

    await this.userRepository.upsertUser({
      id: adminId,
      account: this.defaultAdminAccount,
      name: existingAdmin?.name ?? "默认管理员",
      email: existingAdmin?.email ?? "admin@text2sql.local",
      status: "active",
      isSystemAdmin: true,
      defaultWorkspaceId: this.defaultWorkspaceId,
      systemVariables: this.buildSystemVariables(adminVariables, {
        workspaceIds: [this.defaultWorkspaceId],
        lastPasswordResetAt: this.readServiceMeta(existingAdmin?.systemVariables).lastPasswordResetAt
      }),
      passwordHash: await this.userRepository.getPasswordHash(adminId),
      deletedAt: null
    });

    await this.workspaceRepository.upsertWorkspaceMember({
      userId: adminId,
      workspaceId: this.defaultWorkspaceId,
      role: "admin"
    });
  }

  private async getUserOrThrow(userId: string): Promise<PlatformUser> {
    const user = await this.userRepository.getUserById(userId);
    if (!user) {
      throw new DomainError("USER_NOT_FOUND", "用户不存在。", 404, {
        userId
      });
    }
    return user;
  }

  private async archiveUser(user: PlatformUser): Promise<void> {
    const deletedAt = new Date().toISOString();
    const previousWorkspaceIds = this.readWorkspaceIds(user);
    const suffix = `${Date.now()}-${user.id}`;
    const variables = this.readUserVariables(user.systemVariables);
    const meta = this.readServiceMeta(user.systemVariables);

    await this.userRepository.upsertUser({
      id: user.id,
      account: `${user.account}__deleted__${suffix}`,
      name: user.name,
      email: `deleted+${suffix}@text2sql.local`,
      status: "deleted",
      isSystemAdmin: false,
      defaultWorkspaceId: null,
      systemVariables: this.buildSystemVariables(variables, {
        workspaceIds: [],
        lastPasswordResetAt: meta.lastPasswordResetAt
      }),
      passwordHash: null,
      deletedAt
    });

    await this.syncUserWorkspaceMemberships(user.id, [], previousWorkspaceIds);
  }

  private async assertUniqueAccount(account: string, excludeUserId?: string): Promise<void> {
    const users = await this.listAllUsers({
      includeDeleted: false
    });
    for (const user of users) {
      if (excludeUserId && user.id === excludeUserId) {
        continue;
      }
      if (user.account.toLowerCase() === account.toLowerCase()) {
        throw new DomainError("ACCOUNT_CONFLICT", "账号已存在。", 409, {
          account
        });
      }
    }
  }

  private async assertUniqueEmail(email: string, excludeUserId?: string): Promise<void> {
    const users = await this.listAllUsers({
      includeDeleted: false
    });
    for (const user of users) {
      if (excludeUserId && user.id === excludeUserId) {
        continue;
      }
      if (user.email.toLowerCase() === email.toLowerCase()) {
        throw new DomainError("EMAIL_CONFLICT", "邮箱已存在。", 409, {
          email
        });
      }
    }
  }

  private async listAllUsers(options: {
    includeDeleted: boolean;
    keyword?: string;
    statuses?: PlatformUserStatus[];
  }): Promise<PlatformUser[]> {
    const merged = new Map<string, PlatformUser>();
    let page = 1;
    while (true) {
      const response = await this.userRepository.listUsers({
        includeDeleted: options.includeDeleted,
        keyword: options.keyword,
        statuses: options.statuses,
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

  private async findUserByAccount(
    account: string,
    options?: { includeDeleted?: boolean }
  ): Promise<PlatformUser | undefined> {
    const users = await this.listAllUsers({
      includeDeleted: options?.includeDeleted ?? false
    });
    const normalized = account.trim().toLowerCase();
    return users.find((item) => item.account.toLowerCase() === normalized);
  }

  private async syncUserWorkspaceMemberships(
    userId: string,
    nextWorkspaceIds: string[],
    previousWorkspaceIds: string[]
  ): Promise<void> {
    const next = Array.from(new Set(nextWorkspaceIds));
    const previous = new Set(previousWorkspaceIds);

    for (const workspaceId of next) {
      await this.ensureWorkspaceExists(workspaceId);
      await this.workspaceRepository.upsertWorkspaceMember({
        userId,
        workspaceId,
        role: userId === this.defaultAdminId && workspaceId === this.defaultWorkspaceId ? "admin" : "member"
      });
      previous.delete(workspaceId);
    }

    for (const workspaceId of previous) {
      await this.workspaceRepository.removeWorkspaceMember(userId, workspaceId);
    }
  }

  private async ensureWorkspaceExists(workspaceId: string): Promise<void> {
    const workspace = await this.workspaceRepository.getWorkspaceById(workspaceId, {
      includeDeleted: true
    });
    if (workspace && !workspace.deletedAt) {
      return;
    }

    await this.workspaceRepository.upsertWorkspace({
      id: workspaceId,
      name: workspace?.name ?? workspaceId,
      status: "active",
      isDefault: workspaceId === this.defaultWorkspaceId,
      deletedAt: null
    });
  }

  private isDefaultAdmin(user: PlatformUser): boolean {
    return (
      user.id === this.defaultAdminId ||
      user.account.toLowerCase() === this.defaultAdminAccount
    );
  }

  private normalizeAccount(account: string): string {
    const normalized = account.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", "账号不能为空。", 400, {
        field: "account"
      });
    }
    return normalized;
  }

  private normalizeEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", "邮箱不能为空。", 400, {
        field: "email"
      });
    }
    return normalized;
  }

  private normalizeWorkspaceIds(workspaceIds?: string[]): string[] {
    const normalized = (workspaceIds ?? [this.defaultWorkspaceId])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (normalized.length === 0) {
      throw new DomainError("VALIDATION_ERROR", "至少需要绑定一个工作空间。", 400, {
        field: "workspaceIds"
      });
    }
    const deduped = [...new Set(normalized)];
    for (const workspaceId of deduped) {
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(workspaceId)) {
        throw new DomainError("VALIDATION_ERROR", "工作空间标识格式不合法。", 400, {
          field: "workspaceIds",
          workspaceId
        });
      }
    }
    return deduped;
  }

  private normalizeVariables(variables?: UserVariableDto[]): UserVariable[] {
    const normalized = (variables ?? []).map((item) => ({
      key: item.key.trim(),
      value: item.value.trim()
    }));
    const seen = new Set<string>();
    for (const variable of normalized) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(variable.key)) {
        throw new DomainError("VALIDATION_ERROR", "系统变量 key 格式不合法。", 400, {
          field: "variables",
          key: variable.key
        });
      }
      if (variable.value.length === 0) {
        throw new DomainError("VALIDATION_ERROR", "系统变量 value 不能为空。", 400, {
          field: "variables",
          key: variable.key
        });
      }
      const normalizedKey = variable.key.toLowerCase();
      if (seen.has(normalizedKey)) {
        throw new DomainError("VALIDATION_ERROR", "系统变量 key 不能重复。", 400, {
          field: "variables",
          key: variable.key
        });
      }
      seen.add(normalizedKey);
    }
    return normalized;
  }

  private buildInitialPassword(): string {
    return `Init@${uuidv4().slice(0, 8)}`;
  }

  private buildTemporaryPassword(): string {
    return `Temp@${uuidv4().slice(0, 8)}`;
  }

  private buildSystemVariables(
    variables: UserVariable[],
    meta: UserServiceMeta
  ): Record<string, unknown> | null {
    const payload: Record<string, unknown> = {};
    for (const variable of variables) {
      payload[variable.key] = variable.value;
    }
    payload[USER_SERVICE_META_KEY] = {
      workspaceIds: [...meta.workspaceIds],
      lastPasswordResetAt: meta.lastPasswordResetAt
    };
    return payload;
  }

  private readUserVariables(
    source: Record<string, unknown> | null | undefined
  ): UserVariable[] {
    if (!source) {
      return [];
    }
    const result: UserVariable[] = [];
    for (const [key, value] of Object.entries(source)) {
      if (key === USER_SERVICE_META_KEY) {
        continue;
      }
      if (typeof value !== "string") {
        continue;
      }
      result.push({
        key,
        value
      });
    }
    return result;
  }

  private readServiceMeta(
    source: Record<string, unknown> | null | undefined
  ): UserServiceMeta {
    const fallback: UserServiceMeta = {
      workspaceIds: [],
      lastPasswordResetAt: null
    };
    if (!source) {
      return fallback;
    }
    const raw = source[USER_SERVICE_META_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return fallback;
    }
    const parsed = raw as Record<string, unknown>;
    const workspaceIds = Array.isArray(parsed.workspaceIds)
      ? parsed.workspaceIds
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];
    const lastPasswordResetAt =
      typeof parsed.lastPasswordResetAt === "string"
        ? parsed.lastPasswordResetAt
        : null;

    return {
      workspaceIds,
      lastPasswordResetAt
    };
  }

  private readWorkspaceIds(user: PlatformUser): string[] {
    const metaWorkspaceIds = this.readServiceMeta(user.systemVariables).workspaceIds;
    if (metaWorkspaceIds.length > 0) {
      return metaWorkspaceIds;
    }
    const fallback = user.defaultWorkspaceId?.trim();
    if (fallback) {
      return [fallback];
    }
    return [this.defaultWorkspaceId];
  }

  private toView(user: PlatformUser): UserView {
    const meta = this.readServiceMeta(user.systemVariables);
    const variables = this.readUserVariables(user.systemVariables);

    return {
      id: user.id,
      account: user.account,
      name: user.name,
      email: user.email,
      status: user.status === "disabled" ? "disabled" : "active",
      workspaceIds: this.readWorkspaceIds(user),
      variables: variables.map((item) => ({ ...item })),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastPasswordResetAt: meta.lastPasswordResetAt,
      isSystemAdmin: user.isSystemAdmin
    };
  }
}
