import type { AnalysisTaskStatus } from "@text2sql/analysis-task-protocol";
import { AnalysisTaskCommandService } from "../../src/modules/conversation/analysis/application/analysis-task-command.service";
import { AnalysisTaskService } from "../../src/modules/conversation/analysis/application/analysis-task.service";
import { GovernanceAnalysisAccessFacade } from "../../src/modules/governance/access/governance-analysis-access.facade";
import { AnalysisCommandOutboxRepository } from "../../src/modules/platform/data/persistence/analysis-command-outbox.repository";
import { AnalysisTaskRepository } from "../../src/modules/platform/data/persistence/analysis-task.repository";
import {
  DurableWorkflowPort,
  type DurableWorkflowDescriptor,
  type DurableWorkflowHealth,
  type DurableWorkflowState
} from "../../src/modules/platform/durable/contracts/durable-workflow.port";
import { InMemoryDurableWorkflowAdapter } from "../../src/modules/platform/durable/in-memory-durable-workflow.adapter";
import {
  buildGoalContract,
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("analysis durable runtime", () => {
  let harness: AnalysisLedgerTestHarness;
  let tasks: AnalysisTaskRepository;
  let outbox: AnalysisCommandOutboxRepository;
  let taskService: AnalysisTaskService;
  let durable: InMemoryDurableWorkflowAdapter;
  let commands: AnalysisTaskCommandService;

  const actor = {
    id: "analyst-1",
    role: "user" as const,
    principal: {
      authenticationMethod: "oidc_bearer" as const,
      trustLevel: "verified" as const,
      subject: "analyst-1",
      actorId: "analyst-1",
      roleSet: ["workspace_member" as const],
      authPolicyVersion: "auth-v1",
      digest: "principal-v1"
    }
  };

  beforeEach(async () => {
    harness = await createAnalysisLedgerTestHarness();
    tasks = new AnalysisTaskRepository(harness.prisma);
    outbox = new AnalysisCommandOutboxRepository(harness.prisma);
    const access = {
      assertWorkspaceRead: jest.fn().mockResolvedValue(undefined)
    } as unknown as GovernanceAnalysisAccessFacade;
    taskService = new AnalysisTaskService(tasks, access);
    durable = new InMemoryDurableWorkflowAdapter();
    commands = new AnalysisTaskCommandService(
      taskService,
      tasks,
      outbox,
      durable
    );
  });

  afterEach(async () => {
    commands.onModuleDestroy();
    await durable.close();
    await harness.close();
  });

  it("persists, deduplicates and delivers lifecycle commands", async () => {
    const created = await taskService.create({
      actor,
      goalContract: buildGoalContract(harness.workspaceId),
      idempotencyKey: "durable-task"
    });
    const request = {
      actor,
      taskId: created.task.id,
      commandId: "start-1",
      type: "start" as const,
      expectedTaskVersion: created.task.version,
      expectedAuthorityEpoch: created.task.authorityEpoch
    };

    const first = await commands.accept(request);
    const repeated = await commands.accept(request);
    await eventually(async () => (await outbox.backlogCount()) === 0);

    const queued = await tasks.getReadModel(created.task.id);
    const workflow = await durable.describeWorkflow(created.task.id);
    expect(first.reasonCode).toBe("accepted");
    expect(repeated.reasonCode).toBe("already_accepted");
    expect(queued.task.status).toBe("queued");
    expect(queued.attempts).toHaveLength(1);
    expect(
      queued.events.filter((event) => event.type === "command.accepted")
    ).toHaveLength(1);
    expect(workflow?.status).toBe("running");
    expect(workflow?.processedCommandIds).toEqual(["start-1"]);

    const paused = await commands.accept({
      actor,
      taskId: created.task.id,
      commandId: "pause-1",
      type: "pause",
      expectedTaskVersion: queued.task.version,
      expectedAuthorityEpoch: queued.task.authorityEpoch
    });
    expect(paused.authorityEpoch).toBe(queued.task.authorityEpoch + 1);
    await eventually(async () => (await outbox.backlogCount()) === 0);
    expect((await tasks.getTask(created.task.id))?.status).toBe("paused");
  });

  it("keeps accepted commands reconcilable during provider outage", async () => {
    const failing = new FailingDurableWorkflowAdapter();
    const outageCommands = new AnalysisTaskCommandService(
      taskService,
      tasks,
      outbox,
      failing
    );
    const created = await taskService.create({
      actor,
      goalContract: buildGoalContract(harness.workspaceId),
      idempotencyKey: "provider-outage-task"
    });
    const acceptance = await outageCommands.accept({
      actor,
      taskId: created.task.id,
      commandId: "outage-start",
      type: "start",
      expectedTaskVersion: created.task.version,
      expectedAuthorityEpoch: created.task.authorityEpoch
    });
    await eventually(async () => {
      const record = await outbox.findByCommandId(created.task.id, "outage-start");
      return record?.status === "retry";
    });

    expect(acceptance.accepted).toBe(true);
    expect(await outbox.backlogCount()).toBe(1);
    expect((await tasks.getTask(created.task.id))?.status).toBe("queued");
    outageCommands.onModuleDestroy();
  });

  it("reclaims a dispatcher lease after a process crash", async () => {
    const created = await taskService.create({
      actor,
      goalContract: buildGoalContract(harness.workspaceId),
      idempotencyKey: "dispatcher-recovery-task"
    });
    await outbox.enqueue({
      commandId: "recover-1",
      taskId: created.task.id,
      expectedTaskVersion: created.task.version,
      revisionId: created.currentRevision.id,
      authorityEpoch: created.task.authorityEpoch,
      type: "start",
      actorId: actor.id,
      principalDigest: actor.principal.digest,
      at: new Date().toISOString(),
      payload: {}
    });
    expect(await outbox.claimPending()).toHaveLength(1);
    expect(
      await outbox.requeueStaleProcessing(new Date(Date.now() + 1_000))
    ).toBe(1);
    expect(await outbox.claimPending()).toHaveLength(1);
  });
});

class FailingDurableWorkflowAdapter extends DurableWorkflowPort {
  async startWorkflow(_descriptor: DurableWorkflowDescriptor): Promise<void> {
    throw new Error("temporal unavailable");
  }
  async deliverCommand(): Promise<void> {
    throw new Error("temporal unavailable");
  }
  async describeWorkflow(_taskId: string): Promise<DurableWorkflowState | null> {
    return null;
  }
  async health(): Promise<DurableWorkflowHealth> {
    return {
      provider: "temporal",
      configured: true,
      clientReady: false,
      workerPollerReady: false,
      reasonCode: "temporal_unavailable"
    };
  }
  async close(): Promise<void> {}
}

async function eventually(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition not met before timeout");
}
