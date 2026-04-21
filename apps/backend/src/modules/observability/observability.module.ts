import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { TraceService } from "./trace.service";
import { LangsmithTraceService } from "./langsmith-trace.service";
import { GateMetricsService } from "./gate-metrics.service";
import { RagIngestionMetricsService } from "../rag/observability/rag-ingestion-metrics.service";

@Module({
  imports: [AppConfigModule],
  providers: [
    TraceService,
    LangsmithTraceService,
    GateMetricsService,
    RagIngestionMetricsService
  ],
  exports: [
    TraceService,
    LangsmithTraceService,
    GateMetricsService,
    RagIngestionMetricsService
  ]
})
export class ObservabilityModule {}
