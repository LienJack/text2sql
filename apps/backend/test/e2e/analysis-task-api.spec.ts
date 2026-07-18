import request from "supertest";
import { buildGoalContract } from "../support/analysis-ledger-test-harness";
import {
  analysisRequestHeaders,
  cleanupAnalysisApiTestApp,
  createAnalysisApiTestApp,
  type AnalysisApiTestContext
} from "../support/analysis-api-test-app";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("analysis task api (e2e)", () => {
  let context: AnalysisApiTestContext;

  beforeAll(async () => {
    context = await createAnalysisApiTestApp();
  }, 15_000);

  afterAll(async () => {
    await cleanupAnalysisApiTestApp(context);
  });

  it("supports idempotent lifecycle, replay, terminal reconnect and revocation", async () => {
    const headers = analysisRequestHeaders(context);
    const createResponse = await request(context.app.getHttpServer())
      .post("/api/v1/analysis/tasks")
      .set(headers)
      .set("x-idempotency-key", "quarterly-revenue-task")
      .send({ goalContract: buildGoalContract(context.workspaceId) });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.status).toBe("success");
    const taskId = createResponse.body.data.task.id as string;

    const startBody = {
      commandId: "start-quarterly-revenue",
      type: "start",
      expectedTaskVersion: 1,
      expectedAuthorityEpoch: 1
    };
    const startResponse = await request(context.app.getHttpServer())
      .post(`/api/v1/analysis/tasks/${taskId}/commands`)
      .set(headers)
      .send(startBody);
    const repeatedStart = await request(context.app.getHttpServer())
      .post(`/api/v1/analysis/tasks/${taskId}/commands`)
      .set(headers)
      .send(startBody);
    expect(startResponse.status).toBe(202);
    expect(startResponse.body.data.acceptance.reasonCode).toBe("accepted");
    expect(repeatedStart.body.data.acceptance.reasonCode).toBe(
      "already_accepted"
    );

    await eventually(async () => {
      const response = await request(context.app.getHttpServer())
        .get(`/api/v1/analysis/tasks/${taskId}/events`)
        .set(headers);
      return response.body.data.some(
        (event: { type: string }) => event.type === "command.delivered"
      );
    });
    const queued = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${taskId}`)
      .set(headers);
    expect(queued.body.data.task.status).toBe("queued");

    const pause = await request(context.app.getHttpServer())
      .post(`/api/v1/analysis/tasks/${taskId}/commands`)
      .set(headers)
      .send({
        commandId: "pause-quarterly-revenue",
        type: "pause",
        expectedTaskVersion: queued.body.data.task.version,
        expectedAuthorityEpoch: queued.body.data.task.authorityEpoch
      });
    expect(pause.body.data.acceptance.authorityEpoch).toBe(2);

    const paused = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${taskId}`)
      .set(headers);
    const cancel = await request(context.app.getHttpServer())
      .post(`/api/v1/analysis/tasks/${taskId}/commands`)
      .set(headers)
      .send({
        commandId: "cancel-quarterly-revenue",
        type: "cancel",
        expectedTaskVersion: paused.body.data.task.version,
        expectedAuthorityEpoch: paused.body.data.task.authorityEpoch
      });
    expect(cancel.status).toBe(202);

    await eventually(async () => {
      const response = await request(context.app.getHttpServer())
        .get(`/api/v1/analysis/tasks/${taskId}`)
        .set(headers);
      return response.body.data.task.status === "cancelled";
    });
    const replay = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${taskId}/replay`)
      .set(headers);
    expect(replay.body.data.mode).toBe("artifact_only");
    expect(replay.body.data.externalCallCount).toBe(0);
    expect(replay.body.data.readModel.task.status).toBe("cancelled");

    const stream = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${taskId}/events/stream`)
      .set(headers)
      .set("Last-Event-ID", "0");
    expect(stream.status).toBe(200);
    expect(stream.text).toContain("event: task.created");
    expect(stream.text).toContain("event: command.accepted");

    await context.ledger.requireClient().workspaceMember.deleteMany({
      where: { userId: context.userId, workspaceId: context.workspaceId }
    });
    const deniedTask = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${taskId}`)
      .set(headers);
    const deniedReplay = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${taskId}/replay`)
      .set(headers);
    expect(deniedTask.status).toBe(404);
    expect(deniedTask.body.error.code).toBe("ANALYSIS_TASK_NOT_FOUND");
    expect(deniedReplay.status).toBe(404);
  }, 15_000);
});

async function eventually(
  predicate: () => Promise<boolean>,
  timeoutMs = 8_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met before timeout");
}
