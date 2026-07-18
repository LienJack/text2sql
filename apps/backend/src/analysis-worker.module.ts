import { Module } from "@nestjs/common";
import { AppConfigModule } from "./modules/config/config.module";

@Module({ imports: [AppConfigModule] })
export class AnalysisWorkerModule {}
