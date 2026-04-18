import { Module } from "@nestjs/common";
import { DataModule } from "../../data/data.module";
import { AppConfigModule } from "../../config/config.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { DatasourceController } from "./datasource.controller";
import { DatasourceRegistryService } from "./datasource-registry.service";
import { DatasourceWorkflowService } from "./datasource-workflow.service";
import { DatasourceService } from "./datasource.service";

@Module({
  imports: [AppConfigModule, DataModule, WorkspaceModule],
  controllers: [DatasourceController],
  providers: [DatasourceRegistryService, DatasourceService, DatasourceWorkflowService],
  exports: [DatasourceRegistryService, DatasourceService, DatasourceWorkflowService]
})
export class DatasourceModule {}
