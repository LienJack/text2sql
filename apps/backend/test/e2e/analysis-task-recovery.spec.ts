import request from "supertest";
import { AnalysisTaskCommandService } from "../../src/modules/conversation/analysis/application/analysis-task-command.service";
import { buildGoalContract } from "../support/analysis-ledger-test-harness";
import {
  DurableWorkflowPort,
  type DurableWorkflowDescriptor,
  type DurableWorkflowHealth,
  type DurableWorkflowState
} from "../../src/modules/platform/durable/contracts/durable-workflow.port";
import {
  analysisRequestHeaders,
  cleanupAnalysisApiTestApp,
  createAnalysisApiTestApp,
  type AnalysisApiTestContext
} from "../support/analysis-api-test-app";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("analysis task recovery (e2e)", () => {
  let first: AnalysisApiTestContext;
  let second: AnalysisApiTestContext | undefined;

  afterAll(async () => {
    if (second) {
      await cleanupAnalysisApiTestApp(second);
    } else if (first) {
      await cleanupAnalysisApiTestApp(first);
    }
  });

  it("delivers a persisted outbox command after API/provider restart", async () => {
    first = await createAnalysisApiTestApp(new UnavailableDurableWorkflow());
    const headers = analysisRequestHeaders(first);
    const created = await request(first.app.getHttpServer())
      .post("/api/v1/analysis/tasks")
      .set(headers)
      .set("x-idempotency-key", "restart-recovery-task")
      .send({ goalContract: buildGoalContract(first.workspaceId) });
    const taskId = created.body.data.task.id as string;
    const accepted = await request(first.app.getHttpServer())
      .post(`/api/v1/analysis/tasks/${taskId}/commands`)
      .set(headers)
      .send({
        commandId: "restart-start",
        type: "start",
        expectedTaskVersion: 1,
        expectedAuthorityEpoch: 1
      });
    expect(accepted.status).toBe(202);
    expect(accepted.body.data.acceptance.accepted).toBe(true);

    await eventually(async () => {
      await first.app.get(AnalysisTaskCommandService).dispatchPending();
      const rows = await first.ledger.requireClient().analysisCommandOutbox.findMany({
        where: { taskId }
      });
      return (rows[0] as { status?: string } | undefined)?.status === "retry";
    });
    await first.app.close();

    second = await createAnalysisApiTestApp();
    await second.ledger.requireClient().analysisTask.deleteMany({
      where: { workspaceId: second.workspaceId }
    });
    await second.ledger.requireClient().workspaceMember.deleteMany({
      where: { workspaceId: second.workspaceId }
    });
    await second.ledger.requireClient().platformUser.deleteMany({
      where: { id: second.userId }
    });
    await second.ledger.requireClient().workspace.deleteMany({
      where: { id: second.workspaceId }
    });
    second.workspaceId = first.workspaceId;
    second.userId = first.userId;
    const recoveredHeaders = analysisRequestHeaders(second);

    await eventually(async () => {
      await second!.app.get(AnalysisTaskCommandService).dispatchPending();
      const events = await request(second!.app.getHttpServer())
        .get(`/api/v1/analysis/tasks/${taskId}/events`)
        .set(recoveredHeaders);
      return events.body.data?.some(
        (event: { type: string }) => event.type === "command.delivered"
      );
    }, 5_000);
    const recovered = await request(second.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${taskId}`)
      .set(recoveredHeaders);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.task.status).toBe("queued");
    expect(
      recovered.body.data.events.filter(
        (event: { type: string }) => event.type === "command.delivered"
      )
    ).toHaveLength(1);
  }, 15_000);
});

class UnavailableDurableWorkflow extends DurableWorkflowPort {
  async startWorkflow(_descriptor: DurableWorkflowDescriptor): Promise<void> {
    throw new Error("provider unavailable");
  }
  async deliverCommand(): Promise<void> {
    throw new Error("provider unavailable");
  }
  async describeWorkflow(_taskId: string): Promise<DurableWorkflowState | null> {
    return null;
  }
  async health(): Promise<DurableWorkflowHealth> {
    return {
      provider: "temporal",
      configured: true,
      clientReady: false,
      workerPollerReady: false
    };
  }
  async close(): Promise<void> {}
}

async function eventually(
  predicate: () => Promise<boolean>,
  timeoutMs = 8_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition not met before timeout");
}
