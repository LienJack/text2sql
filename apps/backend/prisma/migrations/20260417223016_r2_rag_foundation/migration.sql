-- CreateTable
CREATE TABLE "rag_documents" (
    "id" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sourceVersion" TEXT NOT NULL,
    "contentChecksum" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "tableNames" TEXT[],
    "columnNames" TEXT[],
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "chunkProfile" TEXT NOT NULL,
    "chunkOrder" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentChecksum" TEXT NOT NULL,
    "tableNames" TEXT[],
    "columnNames" TEXT[],
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_index_versions" (
    "id" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "buildReason" TEXT,
    "sourceVersion" TEXT NOT NULL,
    "createdByRunId" TEXT,
    "activatedByRunId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_index_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_chunk_index_entries" (
    "id" TEXT NOT NULL,
    "indexVersionId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "lexicalContent" TEXT NOT NULL,
    "denseVector" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_chunk_index_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_run_replays" (
    "runId" TEXT NOT NULL,
    "replayKey" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "indexVersionId" TEXT,
    "documentId" TEXT,
    "chunkId" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_run_replays_pkey" PRIMARY KEY ("runId","replayKey")
);

-- CreateIndex
CREATE INDEX "rag_documents_datasourceId_domain_idx" ON "rag_documents"("datasourceId", "domain");

-- CreateIndex
CREATE INDEX "rag_documents_sourceType_sourceVersion_idx" ON "rag_documents"("sourceType", "sourceVersion");

-- CreateIndex
CREATE INDEX "rag_documents_tableNames_idx" ON "rag_documents"("tableNames");

-- CreateIndex
CREATE INDEX "rag_documents_columnNames_idx" ON "rag_documents"("columnNames");

-- CreateIndex
CREATE UNIQUE INDEX "rag_documents_datasourceId_sourceVersion_contentChecksum_key" ON "rag_documents"("datasourceId", "sourceVersion", "contentChecksum");

-- CreateIndex
CREATE INDEX "rag_chunks_datasourceId_domain_chunkProfile_idx" ON "rag_chunks"("datasourceId", "domain", "chunkProfile");

-- CreateIndex
CREATE INDEX "rag_chunks_tableNames_idx" ON "rag_chunks"("tableNames");

-- CreateIndex
CREATE INDEX "rag_chunks_columnNames_idx" ON "rag_chunks"("columnNames");

-- CreateIndex
CREATE UNIQUE INDEX "rag_chunks_documentId_chunkProfile_chunkOrder_key" ON "rag_chunks"("documentId", "chunkProfile", "chunkOrder");

-- CreateIndex
CREATE INDEX "rag_index_versions_datasourceId_status_createdAt_idx" ON "rag_index_versions"("datasourceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "rag_index_versions_createdByRunId_idx" ON "rag_index_versions"("createdByRunId");

-- CreateIndex
CREATE INDEX "rag_index_versions_activatedByRunId_idx" ON "rag_index_versions"("activatedByRunId");

-- CreateIndex
CREATE INDEX "rag_chunk_index_entries_datasourceId_domain_idx" ON "rag_chunk_index_entries"("datasourceId", "domain");

-- CreateIndex
CREATE INDEX "rag_chunk_index_entries_chunkId_idx" ON "rag_chunk_index_entries"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "rag_chunk_index_entries_indexVersionId_chunkId_key" ON "rag_chunk_index_entries"("indexVersionId", "chunkId");

-- CreateIndex
CREATE INDEX "rag_run_replays_datasourceId_stage_createdAt_idx" ON "rag_run_replays"("datasourceId", "stage", "createdAt");

-- CreateIndex
CREATE INDEX "rag_run_replays_indexVersionId_idx" ON "rag_run_replays"("indexVersionId");

-- CreateIndex
CREATE INDEX "rag_run_replays_documentId_idx" ON "rag_run_replays"("documentId");

-- CreateIndex
CREATE INDEX "rag_run_replays_chunkId_idx" ON "rag_run_replays"("chunkId");

-- AddForeignKey
ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_datasourceId_fkey" FOREIGN KEY ("datasourceId") REFERENCES "datasources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "rag_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_datasourceId_fkey" FOREIGN KEY ("datasourceId") REFERENCES "datasources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_index_versions" ADD CONSTRAINT "rag_index_versions_datasourceId_fkey" FOREIGN KEY ("datasourceId") REFERENCES "datasources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_index_versions" ADD CONSTRAINT "rag_index_versions_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_index_versions" ADD CONSTRAINT "rag_index_versions_activatedByRunId_fkey" FOREIGN KEY ("activatedByRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunk_index_entries" ADD CONSTRAINT "rag_chunk_index_entries_indexVersionId_fkey" FOREIGN KEY ("indexVersionId") REFERENCES "rag_index_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunk_index_entries" ADD CONSTRAINT "rag_chunk_index_entries_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "rag_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunk_index_entries" ADD CONSTRAINT "rag_chunk_index_entries_datasourceId_fkey" FOREIGN KEY ("datasourceId") REFERENCES "datasources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_run_replays" ADD CONSTRAINT "rag_run_replays_runId_fkey" FOREIGN KEY ("runId") REFERENCES "sql_runs"("runId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_run_replays" ADD CONSTRAINT "rag_run_replays_datasourceId_fkey" FOREIGN KEY ("datasourceId") REFERENCES "datasources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_run_replays" ADD CONSTRAINT "rag_run_replays_indexVersionId_fkey" FOREIGN KEY ("indexVersionId") REFERENCES "rag_index_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_run_replays" ADD CONSTRAINT "rag_run_replays_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "rag_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_run_replays" ADD CONSTRAINT "rag_run_replays_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "rag_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

