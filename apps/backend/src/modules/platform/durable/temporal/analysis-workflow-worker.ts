import { NativeConnection, Worker } from "@temporalio/worker";
import { AppConfigService } from "../../../config/app-config.service";

export type AnalysisWorkflowWorkerRuntime = {
  worker: Worker;
  connection: NativeConnection;
};

export const createAnalysisWorkflowWorker = async (
  config: AppConfigService
): Promise<AnalysisWorkflowWorkerRuntime> => {
  const connection = await NativeConnection.connect({
    address: config.temporalAddress
  });
  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    workflowsPath: require.resolve("./generic-analysis-workflow")
  });
  return { worker, connection };
};
