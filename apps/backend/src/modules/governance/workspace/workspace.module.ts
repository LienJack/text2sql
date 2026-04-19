import { Module } from "@nestjs/common";
import { WorkspaceAdminGuard } from "../../auth/workspace-admin.guard";
import { PlatformDataModule } from "../../platform/data/data.module";
import { WorkspaceDatasourceController } from "./workspace-datasource.controller";
import { WorkspaceDatasourceService } from "./workspace-datasource.service";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [PlatformDataModule],
  controllers: [WorkspaceController, WorkspaceDatasourceController],
  providers: [WorkspaceService, WorkspaceDatasourceService, WorkspaceAdminGuard],
  exports: [WorkspaceService, WorkspaceDatasourceService]
})
export class WorkspaceModule {}
