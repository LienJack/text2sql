import { AnalysisCommandOutboxRepository } from "../../src/modules/platform/data/persistence/analysis-command-outbox.repository";
import { AnalysisTaskRepository } from "../../src/modules/platform/data/persistence/analysis-task.repository";
import {
  buildGoalContract,
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("AnalysisCommandOutboxRepository", () => {
  let harness: AnalysisLedgerTestHarness;

  beforeEach(async () => {
    harness = await createAnalysisLedgerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("deduplicates commands and claims them once", async () => {
    const taskRepository = new AnalysisTaskRepository(harness.prisma);
    const outbox = new AnalysisCommandOutboxRepository(harness.prisma);
    const task = await taskRepository.createTask({
      workspaceId: harness.workspaceId,
      createdByActorId: "analyst-1",
      principalDigest: "principal-v1",
      authPolicyVersion: "auth-v1",
      idempotencyKey: "outbox-task",
      goalContract: buildGoalContract(harness.workspaceId)
    });
    const command = {
      commandId: "start-command-1",
      taskId: task.task.id,
      expectedTaskVersion: task.task.version,
      revisionId: task.currentRevision.id,
      authorityEpoch: task.task.authorityEpoch,
      type: "start" as const,
      actorId: "analyst-1",
      principalDigest: "principal-v1",
      at: new Date().toISOString(),
      payload: {}
    };

    const first = await outbox.enqueue(command);
    const repeated = await outbox.enqueue(command);
    const claimed = await outbox.claimPending();
    const claimedAgain = await outbox.claimPending();
    const delivered = await outbox.markDelivered(claimed[0]!.id);

    expect(repeated.id).toBe(first.id);
    expect(claimed).toHaveLength(1);
    expect(claimedAgain).toHaveLength(0);
    expect(delivered.status).toBe("delivered");
    expect(await outbox.backlogCount()).toBe(0);
  });
});
