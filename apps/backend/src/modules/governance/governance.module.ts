import { Module } from "@nestjs/common";
import { DatasourceModule } from "./datasource/datasource.module";
import { SettingsModule } from "./settings/settings.module";
import { UserModule } from "./user/user.module";
import { WorkspaceModule } from "./workspace/workspace.module";

@Module({
  imports: [WorkspaceModule, UserModule, DatasourceModule, SettingsModule],
  exports: [WorkspaceModule, UserModule, DatasourceModule, SettingsModule]
})
export class GovernanceModule {}
