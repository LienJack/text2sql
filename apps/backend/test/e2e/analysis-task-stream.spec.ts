import request from "supertest";
import { buildGoalContract } from "../support/analysis-ledger-test-harness";
import {
  analysisRequestHeaders,
  cleanupAnalysisApiTestApp,
  createAnalysisApiTestApp,
  type AnalysisApiTestContext
} from "../support/analysis-api-test-app";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("analysis task stream cursor (e2e)", () => {
  let context: AnalysisApiTestContext;

  beforeAll(async () => {
    context = await createAnalysisApiTestApp();
  }, 15_000);

  afterAll(async () => {
    await cleanupAnalysisApiTestApp(context);
  });

  it("replays only events after the cursor and closes on the canonical terminal state", async () => {
    const headers = analysisRequestHeaders(context);
    const created = await request(context.app.getHttpServer())
      .post("/api/v1/analysis/tasks")
      .set(headers)
      .set("x-idempotency-key", "stream-cursor-task")
      .send({ goalContract: buildGoalContract(context.workspaceId) });
    const task = created.body.data.task as {
      id: string;
      version: number;
      authorityEpoch: number;
    };

    const cancelled = await request(context.app.getHttpServer())
      .post(`/api/v1/analysis/tasks/${task.id}/commands`)
      .set(headers)
      .send({
        commandId: "cancel-stream-cursor-task",
        type: "cancel",
        expectedTaskVersion: task.version,
        expectedAuthorityEpoch: task.authorityEpoch
      });
    expect(cancelled.status).toBe(202);

    const history = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${task.id}/events?after=1`)
      .set(headers);
    expect(history.status).toBe(200);
    expect(
      history.body.data.every((event: { sequence: number }) => event.sequence > 1)
    ).toBe(true);

    const stream = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${task.id}/events/stream?cursor=1`)
      .set(headers);
    expect(stream.status).toBe(200);
    expect(stream.text).not.toContain("event: task.created");
    expect(stream.text).toContain("event: command.accepted");

    const model = await request(context.app.getHttpServer())
      .get(`/api/v1/analysis/tasks/${task.id}`)
      .set(headers);
    expect(model.body.data.task.status).toBe("cancelled");
  }, 15_000);
});
