import { AnalysisTaskRepository } from "../../src/modules/platform/data/persistence/analysis-task.repository";
import {
  buildGoalContract,
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("AnalysisTaskRepository", () => {
  let harness: AnalysisLedgerTestHarness;
  let repository: AnalysisTaskRepository;

  beforeEach(async () => {
    harness = await createAnalysisLedgerTestHarness();
    repository = new AnalysisTaskRepository(harness.prisma);
  });

  afterEach(async () => {
    await harness.close();
  });

  it("creates an idempotent canonical task, revision, attempt and monotonic events", async () => {
    const input = {
      workspaceId: harness.workspaceId,
      createdByActorId: "analyst-1",
      principalDigest: "principal-digest-v1",
      authPolicyVersion: "auth-policy-v1",
      idempotencyKey: "create-quarterly-revenue",
      goalContract: buildGoalContract(harness.workspaceId)
    };

    const [first, repeated] = await Promise.all([
      repository.createTask(input),
      repository.createTask(input)
    ]);
    const attempt = await repository.createAttempt({
      taskId: first.task.id,
      revisionId: first.currentRevision.id,
      idempotencyKey: "attempt-1"
    });
    const repeatedAttempt = await repository.createAttempt({
      taskId: first.task.id,
      revisionId: first.currentRevision.id,
      idempotencyKey: "attempt-1"
    });
    const rebuilt = await repository.getReadModel(first.task.id);

    expect(repeated.task.id).toBe(first.task.id);
    expect(repeated.events).toHaveLength(1);
    expect(repeatedAttempt.id).toBe(attempt.id);
    expect(rebuilt.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(rebuilt.events.map((event) => event.type)).toEqual([
      "task.created",
      "attempt.created"
    ]);
    expect(rebuilt.currentRevision.goalDigest).toBe(rebuilt.task.goalDigest);
  });

  it("supersedes old revisions and rejects stale optimistic versions", async () => {
    const created = await repository.createTask({
      workspaceId: harness.workspaceId,
      createdByActorId: "analyst-1",
      principalDigest: "principal-digest-v1",
      authPolicyVersion: "auth-policy-v1",
      idempotencyKey: "create-revision-test",
      goalContract: buildGoalContract(harness.workspaceId)
    });
    const revised = await repository.appendRevision({
      taskId: created.task.id,
      expectedTaskVersion: created.task.version,
      createdByActorId: "analyst-1",
      principalDigest: "principal-digest-v2",
      authPolicyVersion: "auth-policy-v1",
      goalContract: {
        ...buildGoalContract(harness.workspaceId),
        decisionUse: "修订后的决策用途"
      }
    });

    expect(revised.task.currentRevisionNumber).toBe(2);
    expect(revised.task.authorityEpoch).toBe(2);
    expect(revised.currentRevision.supersedesRevisionId).toBe(
      created.currentRevision.id
    );
    await expect(
      repository.appendRevision({
        taskId: created.task.id,
        expectedTaskVersion: 1,
        createdByActorId: "analyst-1",
        principalDigest: "principal-digest-v3",
        authPolicyVersion: "auth-policy-v1",
        goalContract: buildGoalContract(harness.workspaceId)
      })
    ).rejects.toMatchObject({ code: "ANALYSIS_TASK_VERSION_CONFLICT" });
  });
});
