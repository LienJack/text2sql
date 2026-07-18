import { Module } from "@nestjs/common";
import { GovernanceAccessModule } from "./access/access.module";
import { DatasourceModule } from "./datasource/datasource.module";
import { GovernanceChatAccessFacade } from "./governance-chat-access.facade";
import { SettingsModule } from "./settings/settings.module";
import { UserModule } from "./user/user.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { GovernanceAuthModule } from "./auth/governance-auth.module";
import { GovernanceAnalysisAccessModule } from "./access/governance-analysis-access.module";

@Module({
  imports: [
    GovernanceAuthModule,
    GovernanceAnalysisAccessModule,
    GovernanceAccessModule,
    WorkspaceModule,
    UserModule,
    DatasourceModule,
    SettingsModule
  ],
  providers: [GovernanceChatAccessFacade],
  exports: [
    GovernanceAuthModule,
    GovernanceAnalysisAccessModule,
    GovernanceChatAccessFacade,
    GovernanceAccessModule,
    WorkspaceModule,
    UserModule,
    DatasourceModule,
    SettingsModule
  ]
})
export class GovernanceModule {}
