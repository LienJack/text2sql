import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { PlatformDataQueryModule } from "../../platform/data/query.module";
import { GovernanceAccessModule } from "../access/access.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { DatasourceController } from "./datasource.controller";
import { DatasourceRegistryService } from "./datasource-registry.service";
import { DatasourceWorkflowService } from "./datasource-workflow.service";
import { DatasourceService } from "./datasource.service";

@Module({
  imports: [
    AppConfigModule,
    PlatformDataPersistenceModule,
    PlatformDataQueryModule,
    GovernanceAccessModule,
    WorkspaceModule
  ],
  controllers: [DatasourceController],
  providers: [DatasourceRegistryService, DatasourceService, DatasourceWorkflowService],
  exports: [DatasourceRegistryService, DatasourceService, DatasourceWorkflowService]
})
export class DatasourceModule {}
