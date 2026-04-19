import { Module } from "@nestjs/common";
import { AgentModule } from "../conversation/agent/agent.module";
import { PlatformDataModule } from "../platform/data/data.module";
import { AppConfigModule } from "../config/config.module";
import { EvalController } from "./eval.controller";
import { EvalService } from "./eval.service";

@Module({
  imports: [AgentModule, PlatformDataModule, AppConfigModule],
  controllers: [EvalController],
  providers: [EvalService],
  exports: [EvalService]
})
export class EvalModule {}
