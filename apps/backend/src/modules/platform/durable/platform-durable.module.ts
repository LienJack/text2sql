import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { AppConfigService } from "../../config/app-config.service";
import { DurableWorkflowPort } from "./contracts/durable-workflow.port";
import { InMemoryDurableWorkflowAdapter } from "./in-memory-durable-workflow.adapter";
import { TemporalDurableWorkflowAdapter } from "./temporal/temporal-durable-workflow.adapter";

@Module({
  imports: [AppConfigModule],
  providers: [
    InMemoryDurableWorkflowAdapter,
    TemporalDurableWorkflowAdapter,
    {
      provide: DurableWorkflowPort,
      inject: [
        AppConfigService,
        TemporalDurableWorkflowAdapter,
        InMemoryDurableWorkflowAdapter
      ],
      useFactory: (
        config: AppConfigService,
        temporal: TemporalDurableWorkflowAdapter,
        memory: InMemoryDurableWorkflowAdapter
      ) => (config.analysisDurableProvider === "temporal" ? temporal : memory)
    }
  ],
  exports: [
    DurableWorkflowPort,
    TemporalDurableWorkflowAdapter,
    InMemoryDurableWorkflowAdapter
  ]
})
export class PlatformDurableModule {}
