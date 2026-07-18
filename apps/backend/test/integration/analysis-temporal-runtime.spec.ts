import { Client, Connection } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { v4 as uuidv4 } from "uuid";
import type { AppConfigService } from "../../src/modules/config/app-config.service";
import { createAnalysisWorkflowWorker } from "../../src/modules/platform/durable/temporal/analysis-workflow-worker";
import { TemporalDurableWorkflowAdapter } from "../../src/modules/platform/durable/temporal/temporal-durable-workflow.adapter";

const describeWithTemporal =
  process.env.TEMPORAL_INTEGRATION_TEST === "true" ? describe : describe.skip;

describeWithTemporal("analysis Temporal runtime", () => {
  jest.setTimeout(30_000);

  it("survives duplicate signals and replays closed workflow history", async () => {
    const config = {
      temporalAddress: process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
      temporalNamespace: "default",
      temporalTaskQueue: `analysis-integration-${uuidv4()}`,
      temporalConnectionTimeoutMs: 5_000
    } as AppConfigService;
    const runtime = await createAnalysisWorkflowWorker(config);
    const workerRun = runtime.worker.run();
    const adapter = new TemporalDurableWorkflowAdapter(config);
    const taskId = uuidv4();
    const descriptor = {
      taskId,
      revisionId: uuidv4(),
      authorityEpoch: 1,
      taskVersion: 1
    };
    const start = {
      commandId: "start-1",
      taskId,
      expectedTaskVersion: 1,
      acceptedTaskVersion: 2,
      revisionId: descriptor.revisionId,
      authorityEpoch: 1,
      acceptedAuthorityEpoch: 1,
      type: "start" as const,
      actorId: "temporal-test",
      principalDigest: "principal-v1",
      at: new Date().toISOString(),
      payload: {}
    };
    try {
      await adapter.startWorkflow(descriptor);
      await adapter.deliverCommand(start);
      await adapter.deliverCommand(start);
      await eventually(async () => {
        const state = await adapter.describeWorkflow(taskId);
        return state?.status === "running";
      });
      const cancel = {
        ...start,
        commandId: "cancel-1",
        expectedTaskVersion: 2,
        acceptedTaskVersion: 3,
        authorityEpoch: 1,
        acceptedAuthorityEpoch: 2,
        type: "cancel" as const,
        at: new Date().toISOString()
      };
      await adapter.deliverCommand(cancel);

      const connection = await Connection.connect({
        address: config.temporalAddress,
        connectTimeout: config.temporalConnectionTimeoutMs
      });
      try {
        const client = new Client({
          connection,
          namespace: config.temporalNamespace
        });
        const handle = client.workflow.getHandle(`analysis-task:${taskId}`);
        const result = await handle.result();
        expect(result.status).toBe("cancelled");
        expect(result.processedCommandIds).toEqual(["start-1", "cancel-1"]);
        const history = await handle.fetchHistory();
        await Worker.runReplayHistory(
          {
            workflowsPath: require.resolve(
              "../../src/modules/platform/durable/temporal/generic-analysis-workflow"
            )
          },
          history,
          `analysis-task:${taskId}`
        );
      } finally {
        await connection.close();
      }
    } finally {
      await adapter.close();
      runtime.worker.shutdown();
      await workerRun;
      await runtime.connection.close();
    }
  });
});

async function eventually(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000
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
