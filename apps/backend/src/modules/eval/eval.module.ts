import { Module } from "@nestjs/common";
import { AgentModule } from "../conversation/agent/agent.module";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { AppConfigModule } from "../config/config.module";
import { EvalController } from "./eval.controller";
import { EvalService } from "./eval.service";

@Module({
  imports: [AgentModule, PlatformDataPersistenceModule, AppConfigModule],
  controllers: [EvalController],
  providers: [EvalService],
  exports: [EvalService]
})
export class EvalModule {}
