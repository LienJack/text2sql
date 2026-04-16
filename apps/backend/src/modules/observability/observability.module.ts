import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { TraceService } from "./trace.service";
import { LangsmithTraceService } from "./langsmith-trace.service";
import { GateMetricsService } from "./gate-metrics.service";

@Module({
  imports: [AppConfigModule],
  providers: [TraceService, LangsmithTraceService, GateMetricsService],
  exports: [TraceService, LangsmithTraceService, GateMetricsService]
})
export class ObservabilityModule {}
