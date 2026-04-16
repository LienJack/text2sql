-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_users" (
    "id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "systemVariables" TEXT,
    "defaultWorkspaceId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_name_key" ON "workspaces"("name");

-- CreateIndex
CREATE INDEX "workspaces_status_deletedAt_idx" ON "workspaces"("status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_account_key" ON "platform_users"("account");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE INDEX "platform_users_status_deletedAt_idx" ON "platform_users"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "platform_users_defaultWorkspaceId_idx" ON "platform_users"("defaultWorkspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_userId_workspaceId_key" ON "workspace_members"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "workspace_members_workspaceId_role_idx" ON "workspace_members"("workspaceId", "role");

-- CreateIndex
CREATE INDEX "workspace_members_userId_role_idx" ON "workspace_members"("userId", "role");

-- Protect "single default workspace" and "single system admin" semantics.
CREATE UNIQUE INDEX "workspaces_single_default_idx"
ON "workspaces" ("isDefault")
WHERE "isDefault" = true;

CREATE UNIQUE INDEX "platform_users_single_system_admin_idx"
ON "platform_users" ("isSystemAdmin")
WHERE "isSystemAdmin" = true;

-- AddForeignKey
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_defaultWorkspaceId_fkey" FOREIGN KEY ("defaultWorkspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_status_check"
CHECK ("status" IN ('active', 'archived', 'deleted'));

ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_status_check"
CHECK ("status" IN ('active', 'disabled', 'deleted'));

ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_role_check"
CHECK ("role" IN ('admin', 'member'));

-- Seed default workspace + default system admin + baseline membership.
INSERT INTO "workspaces" ("id", "name", "status", "isDefault", "createdAt", "updatedAt")
VALUES ('workspace_default', '默认工作空间', 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "platform_users" ("id", "account", "name", "email", "status", "isSystemAdmin", "defaultWorkspaceId", "createdAt", "updatedAt")
VALUES ('user_system_admin', 'admin', '系统管理员', 'admin@text2sql.local', 'active', true, 'workspace_default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("account") DO NOTHING;

INSERT INTO "workspace_members" ("id", "userId", "workspaceId", "role", "createdAt", "updatedAt")
VALUES ('workspace_member_system_admin_default', 'user_system_admin', 'workspace_default', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("userId", "workspaceId") DO NOTHING;
