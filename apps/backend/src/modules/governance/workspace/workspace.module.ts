import { Module } from "@nestjs/common";
import { WorkspaceAdminGuard } from "../../auth/workspace-admin.guard";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { PlatformDataQueryModule } from "../../platform/data/query.module";
import { WorkspaceDatasourceController } from "./workspace-datasource.controller";
import { WorkspaceDatasourceService } from "./workspace-datasource.service";
import { WorkspaceModelingController } from "./workspace-modeling.controller";
import { WorkspaceModelingService } from "./workspace-modeling.service";
import { WorkspaceRelationshipController } from "./workspace-relationship.controller";
import { WorkspaceRelationshipService } from "./workspace-relationship.service";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [PlatformDataPersistenceModule, PlatformDataQueryModule],
  controllers: [
    WorkspaceController,
    WorkspaceDatasourceController,
    WorkspaceModelingController,
    WorkspaceRelationshipController
  ],
  providers: [
    WorkspaceService,
    WorkspaceDatasourceService,
    WorkspaceModelingService,
    WorkspaceRelationshipService,
    WorkspaceAdminGuard
  ],
  exports: [
    WorkspaceService,
    WorkspaceDatasourceService,
    WorkspaceModelingService,
    WorkspaceRelationshipService
  ]
})
export class WorkspaceModule {}
