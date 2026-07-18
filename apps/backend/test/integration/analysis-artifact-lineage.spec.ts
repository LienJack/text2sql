import { PostgresArtifactPayloadStoreService } from "../../src/modules/platform/artifacts/postgres-artifact-payload-store.service";
import { AnalysisArtifactRepository } from "../../src/modules/platform/data/persistence/analysis-artifact.repository";
import { AnalysisLedgerPrismaService } from "../../src/modules/platform/data/persistence/analysis-ledger-prisma.service";
import { AnalysisTaskRepository } from "../../src/modules/platform/data/persistence/analysis-task.repository";
import {
  buildGoalContract,
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("analysis artifact lineage", () => {
  let harness: AnalysisLedgerTestHarness;

  beforeEach(async () => {
    harness = await createAnalysisLedgerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("commits immutable artifacts, receipts and a replayable manifest", async () => {
    const taskRepository = new AnalysisTaskRepository(harness.prisma);
    const payloadStore = new PostgresArtifactPayloadStoreService(
      harness.config,
      harness.prisma
    );
    const artifactRepository = new AnalysisArtifactRepository(
      harness.prisma,
      payloadStore,
      harness.config
    );
    const task = await taskRepository.createTask({
      workspaceId: harness.workspaceId,
      createdByActorId: "analyst-1",
      principalDigest: "principal-v1",
      authPolicyVersion: "auth-v1",
      idempotencyKey: "artifact-task",
      goalContract: buildGoalContract(harness.workspaceId)
    });
    const attempt = await taskRepository.createAttempt({
      taskId: task.task.id,
      revisionId: task.currentRevision.id,
      idempotencyKey: "artifact-attempt"
    });
    const source = await artifactRepository.commitArtifact({
      artifactId: `source-${task.task.id}`,
      taskId: task.task.id,
      revisionId: task.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: task.task.authorityEpoch,
      artifactType: "sql_result",
      schemaVersion: "sql-result.v1",
      classification: "workspace",
      visibility: "internal",
      completeness: "complete",
      payload: { columns: ["revenue"], rows: [{ revenue: 100 }] },
      receipt: {
        receiptType: "accuracy",
        decision: "accepted",
        reasonCodes: [],
        principalDigest: "principal-v1",
        policyRefs: { text2sqlAccuracy: "receipt-v1" }
      }
    });
    const repeated = await artifactRepository.commitArtifact({
      artifactId: source.id,
      taskId: task.task.id,
      revisionId: task.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: task.task.authorityEpoch,
      artifactType: "sql_result",
      schemaVersion: "sql-result.v1",
      classification: "workspace",
      visibility: "internal",
      completeness: "complete",
      payload: { columns: ["revenue"], rows: [{ revenue: 100 }] }
    });
    const derived = await artifactRepository.commitArtifact({
      taskId: task.task.id,
      revisionId: task.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: task.task.authorityEpoch,
      artifactType: "calculation",
      schemaVersion: "calculation.v1",
      classification: "workspace",
      visibility: "user",
      completeness: "complete",
      payload: { operator: "delta", value: -20 },
      links: [{ targetArtifactId: source.id, relationType: "derived_from" }]
    });
    const beforeManifest = await taskRepository.getReadModel(task.task.id);
    const manifest = await artifactRepository.sealManifest({
      taskId: task.task.id,
      revisionId: task.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: task.task.authorityEpoch,
      manifestType: "analysis-replay",
      schemaVersion: "analysis-manifest.v1",
      status: "HOLD",
      artifactRefs: [source.id, derived.id],
      receiptRefs: beforeManifest.receipts.map((receipt) => receipt.id),
      limitations: ["real_outcome_evidence_missing"]
    });

    expect(repeated.payloadDigest).toBe(source.payloadDigest);
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect((await payloadStore.read(source.id)).available).toBe(true);

    await harness.prisma.onModuleDestroy();
    const restartedPrisma = new AnalysisLedgerPrismaService(harness.config);
    await restartedPrisma.onModuleInit();
    const restartedTaskRepository = new AnalysisTaskRepository(restartedPrisma);
    const rebuilt = await restartedTaskRepository.getReadModel(task.task.id);
    expect(rebuilt.artifacts).toHaveLength(2);
    expect(rebuilt.manifests[0]?.digest).toBe(manifest.digest);
    await restartedPrisma.onModuleDestroy();

    harness.prisma = new AnalysisLedgerPrismaService(harness.config);
    await harness.prisma.onModuleInit();
  });

  it("rejects late artifact commits after a revision changes authority epoch", async () => {
    const taskRepository = new AnalysisTaskRepository(harness.prisma);
    const payloadStore = new PostgresArtifactPayloadStoreService(
      harness.config,
      harness.prisma
    );
    const artifactRepository = new AnalysisArtifactRepository(
      harness.prisma,
      payloadStore,
      harness.config
    );
    const task = await taskRepository.createTask({
      workspaceId: harness.workspaceId,
      createdByActorId: "analyst-1",
      principalDigest: "principal-v1",
      authPolicyVersion: "auth-v1",
      idempotencyKey: "late-artifact-task",
      goalContract: buildGoalContract(harness.workspaceId)
    });
    const attempt = await taskRepository.createAttempt({
      taskId: task.task.id,
      revisionId: task.currentRevision.id,
      idempotencyKey: "late-artifact-attempt"
    });
    await taskRepository.appendRevision({
      taskId: task.task.id,
      expectedTaskVersion: task.task.version,
      createdByActorId: "analyst-1",
      principalDigest: "principal-v2",
      authPolicyVersion: "auth-v1",
      goalContract: {
        ...buildGoalContract(harness.workspaceId),
        objective: "修订后的目标"
      }
    });

    await expect(
      artifactRepository.commitArtifact({
        taskId: task.task.id,
        revisionId: task.currentRevision.id,
        attemptId: attempt.id,
        authorityEpoch: task.task.authorityEpoch,
        artifactType: "late_result",
        schemaVersion: "late.v1",
        classification: "workspace",
        visibility: "internal",
        completeness: "complete",
        payload: { value: "late" }
      })
    ).rejects.toMatchObject({ code: "ANALYSIS_COMMIT_AUTHORITY_STALE" });
  });

  it("retains metadata and digest after an authorized payload expires", async () => {
    const taskRepository = new AnalysisTaskRepository(harness.prisma);
    const payloadStore = new PostgresArtifactPayloadStoreService(
      harness.config,
      harness.prisma
    );
    const artifactRepository = new AnalysisArtifactRepository(
      harness.prisma,
      payloadStore,
      harness.config
    );
    const task = await taskRepository.createTask({
      workspaceId: harness.workspaceId,
      createdByActorId: "analyst-1",
      principalDigest: "principal-v1",
      authPolicyVersion: "auth-v1",
      idempotencyKey: "retention-task",
      goalContract: buildGoalContract(harness.workspaceId)
    });
    const artifact = await artifactRepository.commitArtifact({
      taskId: task.task.id,
      revisionId: task.currentRevision.id,
      authorityEpoch: task.task.authorityEpoch,
      artifactType: "source_snapshot",
      schemaVersion: "source-snapshot.v1",
      classification: "workspace",
      visibility: "internal",
      completeness: "complete",
      payload: { content: "retained only until declared expiry" },
      retentionExpiresAt: new Date(Date.now() - 1_000).toISOString()
    });

    expect(await payloadStore.read(artifact.id)).toMatchObject({
      available: false,
      reason: "expired",
      digest: artifact.payloadDigest
    });
    expect(await payloadStore.purgeExpired()).toBe(1);
    const rebuilt = await taskRepository.getReadModel(task.task.id);
    expect(rebuilt.artifacts[0]).toMatchObject({
      id: artifact.id,
      payloadAvailable: false,
      payloadDigest: artifact.payloadDigest
    });
  });
});
