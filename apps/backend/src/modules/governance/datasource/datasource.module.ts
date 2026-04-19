import { Module } from "@nestjs/common";
import { PlatformDataModule } from "../../platform/data/data.module";
import { AppConfigModule } from "../../config/config.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { DatasourceController } from "./datasource.controller";
import { DatasourceRegistryService } from "./datasource-registry.service";
import { DatasourceWorkflowService } from "./datasource-workflow.service";
import { DatasourceService } from "./datasource.service";

@Module({
  imports: [AppConfigModule, PlatformDataModule, WorkspaceModule],
  controllers: [DatasourceController],
  providers: [DatasourceRegistryService, DatasourceService, DatasourceWorkflowService],
  exports: [DatasourceRegistryService, DatasourceService, DatasourceWorkflowService]
})
export class DatasourceModule {}
