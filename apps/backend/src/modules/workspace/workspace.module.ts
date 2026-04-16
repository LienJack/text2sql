import { Module } from "@nestjs/common";
import { WorkspaceAdminGuard } from "../auth/workspace-admin.guard";
import { DataModule } from "../data/data.module";
import { WorkspaceDatasourceController } from "./workspace-datasource.controller";
import { WorkspaceDatasourceService } from "./workspace-datasource.service";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [DataModule],
  controllers: [WorkspaceController, WorkspaceDatasourceController],
  providers: [WorkspaceService, WorkspaceDatasourceService, WorkspaceAdminGuard],
  exports: [WorkspaceService, WorkspaceDatasourceService]
})
export class WorkspaceModule {}
