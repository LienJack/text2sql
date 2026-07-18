import { Module } from "@nestjs/common";
import { ObservabilityModule } from "../../observability/observability.module";
import { AnalysisTelemetryService } from "./analysis-telemetry.service";

@Module({
  imports: [ObservabilityModule],
  providers: [AnalysisTelemetryService],
  exports: [ObservabilityModule, AnalysisTelemetryService]
})
export class PlatformObservabilityModule {}
