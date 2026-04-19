import { Module } from "@nestjs/common";
import { WorkspaceAdminGuard } from "../../auth/workspace-admin.guard";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { PlatformDataQueryModule } from "../../platform/data/query.module";
import { WorkspaceDatasourceController } from "./workspace-datasource.controller";
import { WorkspaceDatasourceService } from "./workspace-datasource.service";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [PlatformDataPersistenceModule, PlatformDataQueryModule],
  controllers: [WorkspaceController, WorkspaceDatasourceController],
  providers: [WorkspaceService, WorkspaceDatasourceService, WorkspaceAdminGuard],
  exports: [WorkspaceService, WorkspaceDatasourceService]
})
export class WorkspaceModule {}
