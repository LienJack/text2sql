-- CreateTable
CREATE TABLE "datasources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "readonly" BOOLEAN NOT NULL DEFAULT true,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT,
    "fileMeta" TEXT,
    "unavailableAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "datasources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "datasources_deletedAt_status_idx" ON "datasources"("deletedAt", "status");

-- CreateIndex
CREATE INDEX "datasources_type_status_idx" ON "datasources"("type", "status");

-- Seed the default sqlite datasource used by existing sessions.
INSERT INTO "datasources" ("id", "name", "type", "status", "readonly", "shared", "createdAt", "updatedAt")
VALUES ('sqlite_main', 'SQLite 主数据源', 'sqlite', 'available', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_datasource_fkey" FOREIGN KEY ("datasource") REFERENCES "datasources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
