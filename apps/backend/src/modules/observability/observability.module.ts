import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { TraceService } from "./trace.service";
import { LangsmithTraceService } from "./langsmith-trace.service";

@Module({
  imports: [AppConfigModule],
  providers: [TraceService, LangsmithTraceService],
  exports: [TraceService, LangsmithTraceService]
})
export class ObservabilityModule {}
