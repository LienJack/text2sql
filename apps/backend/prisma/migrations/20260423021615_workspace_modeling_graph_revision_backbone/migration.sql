-- CreateTable
CREATE TABLE "workspace_modeling_graph_revisions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "graphHash" TEXT NOT NULL,
    "graphPayload" TEXT NOT NULL,
    "createdByActorId" TEXT,
    "activatedByActorId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_modeling_graph_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_modeling_graph_revisions_status_revision_idx" ON "workspace_modeling_graph_revisions"("workspaceId", "datasourceId", "status", "revision");

-- CreateIndex
CREATE INDEX "workspace_modeling_graph_revisions_updated_at_idx" ON "workspace_modeling_graph_revisions"("workspaceId", "datasourceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_modeling_graph_revisions_workspaceId_datasourceId_key" ON "workspace_modeling_graph_revisions"("workspaceId", "datasourceId", "revision");

-- AddForeignKey
ALTER TABLE "workspace_modeling_graph_revisions" ADD CONSTRAINT "workspace_modeling_graph_revisions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_modeling_graph_revisions" ADD CONSTRAINT "workspace_modeling_graph_revisions_datasourceId_fkey" FOREIGN KEY ("datasourceId") REFERENCES "datasources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
