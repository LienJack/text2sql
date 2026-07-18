import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AnalysisWorkerModule } from "./analysis-worker.module";
import { AppConfigService } from "./modules/config/app-config.service";
import { createAnalysisWorkflowWorker } from "./modules/platform/durable/temporal/analysis-workflow-worker";

async function bootstrap(): Promise<void> {
  const logger = new Logger("AnalysisWorkflowWorker");
  const app = await NestFactory.createApplicationContext(AnalysisWorkerModule);
  const config = app.get(AppConfigService);
  config.assertAnalysisWorkerConfig();
  const runtime = await createAnalysisWorkflowWorker(config);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    runtime.worker.shutdown();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  logger.log(`polling Temporal task queue ${config.temporalTaskQueue}`);
  try {
    await runtime.worker.run();
  } finally {
    await runtime.connection.close();
    await app.close();
  }
}

void bootstrap();
