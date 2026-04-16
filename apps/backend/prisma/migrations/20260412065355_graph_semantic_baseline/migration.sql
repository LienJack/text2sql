-- CreateTable
CREATE TABLE "agent_audit_logs" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "sessionId" TEXT,
    "phase" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "eventType" TEXT NOT NULL,
    "eventCode" TEXT,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_snapshots" (
    "id" TEXT NOT NULL,
    "datasource" TEXT NOT NULL,
    "graphType" TEXT NOT NULL,
    "graphVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "checksum" TEXT,
    "payload" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_edges" (
    "id" TEXT NOT NULL,
    "datasource" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "sourceRunId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semantic_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_memories" (
    "id" TEXT NOT NULL,
    "datasource" TEXT NOT NULL,
    "semanticType" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sourceRunId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semantic_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_audit_logs_eventType_createdAt_idx" ON "agent_audit_logs"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "agent_audit_logs_runId_createdAt_idx" ON "agent_audit_logs"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_audit_logs_sessionId_createdAt_idx" ON "agent_audit_logs"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "graph_snapshots_datasource_graphType_status_idx" ON "graph_snapshots"("datasource", "graphType", "status");

-- CreateIndex
CREATE INDEX "graph_snapshots_sourceRunId_idx" ON "graph_snapshots"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_edges_datasource_subjectKey_predicate_objectKey_key" ON "semantic_edges"("datasource", "subjectKey", "predicate", "objectKey");

-- CreateIndex
CREATE INDEX "semantic_edges_datasource_predicate_idx" ON "semantic_edges"("datasource", "predicate");

-- CreateIndex
CREATE INDEX "semantic_edges_sourceRunId_idx" ON "semantic_edges"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_memories_datasource_semanticType_canonicalKey_key" ON "semantic_memories"("datasource", "semanticType", "canonicalKey");

-- CreateIndex
CREATE INDEX "semantic_memories_datasource_semanticType_idx" ON "semantic_memories"("datasource", "semanticType");

-- CreateIndex
CREATE INDEX "semantic_memories_sourceRunId_idx" ON "semantic_memories"("sourceRunId");

-- AddForeignKey
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_snapshots" ADD CONSTRAINT "graph_snapshots_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_edges" ADD CONSTRAINT "semantic_edges_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_memories" ADD CONSTRAINT "semantic_memories_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;
