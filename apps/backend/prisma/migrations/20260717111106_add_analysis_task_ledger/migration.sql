-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "analysisTaskId" TEXT,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'chat';

-- CreateTable
CREATE TABLE "analysis_tasks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByActorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentRevisionNumber" INTEGER NOT NULL DEFAULT 1,
    "authorityEpoch" INTEGER NOT NULL DEFAULT 1,
    "goalDigest" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "retentionExpiresAt" TIMESTAMP(3),
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_task_revisions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "goalContract" TEXT NOT NULL,
    "goalDigest" TEXT NOT NULL,
    "principalDigest" TEXT NOT NULL,
    "authPolicyVersion" TEXT NOT NULL,
    "createdByActorId" TEXT NOT NULL,
    "supersedesRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_task_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_attempts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "authorityEpoch" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "failureReasonCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_events" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revisionId" TEXT,
    "attemptId" TEXT,
    "sequence" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'user',
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_artifacts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "attemptId" TEXT,
    "artifactType" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "classification" TEXT NOT NULL DEFAULT 'internal',
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "payloadDigest" TEXT NOT NULL,
    "payloadSizeBytes" INTEGER NOT NULL,
    "completeness" TEXT NOT NULL DEFAULT 'complete',
    "retentionExpiresAt" TIMESTAMP(3),
    "staleAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_artifact_payloads" (
    "artifactId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "analysis_artifact_payloads_pkey" PRIMARY KEY ("artifactId")
);

-- CreateTable
CREATE TABLE "analysis_artifact_links" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "targetArtifactId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_artifact_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_receipts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "attemptId" TEXT,
    "artifactId" TEXT,
    "receiptType" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "subjectDigest" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reasonCodes" TEXT[],
    "authorityEpoch" INTEGER NOT NULL,
    "principalDigest" TEXT NOT NULL,
    "policyRefs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_decisions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scopeDigest" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_manifests" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "attemptId" TEXT,
    "manifestType" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "artifactRefs" TEXT NOT NULL,
    "receiptRefs" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "staleAt" TIMESTAMP(3),
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_command_outbox" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastReasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_command_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_tasks_workspaceId_status_updatedAt_idx" ON "analysis_tasks"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "analysis_tasks_createdByActorId_updatedAt_idx" ON "analysis_tasks"("createdByActorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_tasks_workspaceId_idempotencyKey_key" ON "analysis_tasks"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "analysis_task_revisions_taskId_status_createdAt_idx" ON "analysis_task_revisions"("taskId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "analysis_task_revisions_supersedesRevisionId_idx" ON "analysis_task_revisions"("supersedesRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_task_revisions_taskId_revision_key" ON "analysis_task_revisions"("taskId", "revision");

-- CreateIndex
CREATE INDEX "analysis_attempts_revisionId_status_updatedAt_idx" ON "analysis_attempts"("revisionId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_attempts_taskId_attempt_key" ON "analysis_attempts"("taskId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_attempts_taskId_idempotencyKey_key" ON "analysis_attempts"("taskId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "analysis_events_taskId_createdAt_idx" ON "analysis_events"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "analysis_events_attemptId_sequence_idx" ON "analysis_events"("attemptId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_events_taskId_sequence_key" ON "analysis_events"("taskId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_events_taskId_idempotencyKey_key" ON "analysis_events"("taskId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "analysis_artifacts_taskId_artifactType_createdAt_idx" ON "analysis_artifacts"("taskId", "artifactType", "createdAt");

-- CreateIndex
CREATE INDEX "analysis_artifacts_revisionId_status_createdAt_idx" ON "analysis_artifacts"("revisionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "analysis_artifacts_attemptId_createdAt_idx" ON "analysis_artifacts"("attemptId", "createdAt");

-- CreateIndex
CREATE INDEX "analysis_artifacts_retentionExpiresAt_idx" ON "analysis_artifacts"("retentionExpiresAt");

-- CreateIndex
CREATE INDEX "analysis_artifact_payloads_expiresAt_deletedAt_idx" ON "analysis_artifact_payloads"("expiresAt", "deletedAt");

-- CreateIndex
CREATE INDEX "analysis_artifact_links_taskId_relationType_createdAt_idx" ON "analysis_artifact_links"("taskId", "relationType", "createdAt");

-- CreateIndex
CREATE INDEX "analysis_artifact_links_targetArtifactId_relationType_idx" ON "analysis_artifact_links"("targetArtifactId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_artifact_links_sourceArtifactId_targetArtifactId_r_key" ON "analysis_artifact_links"("sourceArtifactId", "targetArtifactId", "relationType");

-- CreateIndex
CREATE INDEX "analysis_receipts_taskId_receiptType_createdAt_idx" ON "analysis_receipts"("taskId", "receiptType", "createdAt");

-- CreateIndex
CREATE INDEX "analysis_receipts_subjectRef_subjectDigest_idx" ON "analysis_receipts"("subjectRef", "subjectDigest");

-- CreateIndex
CREATE INDEX "analysis_receipts_artifactId_idx" ON "analysis_receipts"("artifactId");

-- CreateIndex
CREATE INDEX "analysis_decisions_taskId_decisionType_createdAt_idx" ON "analysis_decisions"("taskId", "decisionType", "createdAt");

-- CreateIndex
CREATE INDEX "analysis_decisions_revisionId_status_expiresAt_idx" ON "analysis_decisions"("revisionId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "analysis_manifests_taskId_manifestType_sealedAt_idx" ON "analysis_manifests"("taskId", "manifestType", "sealedAt");

-- CreateIndex
CREATE INDEX "analysis_manifests_revisionId_status_sealedAt_idx" ON "analysis_manifests"("revisionId", "status", "sealedAt");

-- CreateIndex
CREATE INDEX "analysis_command_outbox_status_nextAttemptAt_createdAt_idx" ON "analysis_command_outbox"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_command_outbox_taskId_commandId_key" ON "analysis_command_outbox"("taskId", "commandId");

-- CreateIndex
CREATE INDEX "sessions_origin_analysisTaskId_deletedAt_idx" ON "sessions"("origin", "analysisTaskId", "deletedAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_analysisTaskId_fkey" FOREIGN KEY ("analysisTaskId") REFERENCES "analysis_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_tasks" ADD CONSTRAINT "analysis_tasks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_task_revisions" ADD CONSTRAINT "analysis_task_revisions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_task_revisions" ADD CONSTRAINT "analysis_task_revisions_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "analysis_task_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_attempts" ADD CONSTRAINT "analysis_attempts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_attempts" ADD CONSTRAINT "analysis_attempts_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "analysis_task_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "analysis_task_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_events" ADD CONSTRAINT "analysis_events_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "analysis_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_artifacts" ADD CONSTRAINT "analysis_artifacts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_artifacts" ADD CONSTRAINT "analysis_artifacts_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "analysis_task_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_artifacts" ADD CONSTRAINT "analysis_artifacts_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "analysis_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_artifact_payloads" ADD CONSTRAINT "analysis_artifact_payloads_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "analysis_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_artifact_links" ADD CONSTRAINT "analysis_artifact_links_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_artifact_links" ADD CONSTRAINT "analysis_artifact_links_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "analysis_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_artifact_links" ADD CONSTRAINT "analysis_artifact_links_targetArtifactId_fkey" FOREIGN KEY ("targetArtifactId") REFERENCES "analysis_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_receipts" ADD CONSTRAINT "analysis_receipts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_receipts" ADD CONSTRAINT "analysis_receipts_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "analysis_task_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_receipts" ADD CONSTRAINT "analysis_receipts_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "analysis_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_receipts" ADD CONSTRAINT "analysis_receipts_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "analysis_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_decisions" ADD CONSTRAINT "analysis_decisions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_decisions" ADD CONSTRAINT "analysis_decisions_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "analysis_task_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_manifests" ADD CONSTRAINT "analysis_manifests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_manifests" ADD CONSTRAINT "analysis_manifests_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "analysis_task_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_manifests" ADD CONSTRAINT "analysis_manifests_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "analysis_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_command_outbox" ADD CONSTRAINT "analysis_command_outbox_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
