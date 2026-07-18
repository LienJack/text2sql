import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { PrincipalContextGuard } from "./principal-context.guard";
import { TrustedPrincipalService } from "./trusted-principal.service";

@Module({
  imports: [AppConfigModule, PlatformDataPersistenceModule],
  providers: [TrustedPrincipalService, PrincipalContextGuard],
  exports: [TrustedPrincipalService, PrincipalContextGuard]
})
export class GovernanceAuthModule {}
