import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { DataModule } from "../data/data.module";
import { AppConfigModule } from "../config/config.module";
import { EvalController } from "./eval.controller";
import { EvalService } from "./eval.service";

@Module({
  imports: [AgentModule, DataModule, AppConfigModule],
  controllers: [EvalController],
  providers: [EvalService],
  exports: [EvalService]
})
export class EvalModule {}

