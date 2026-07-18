import { Module } from "@nestjs/common";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { GovernanceAnalysisAccessFacade } from "./governance-analysis-access.facade";

@Module({
  imports: [PlatformDataPersistenceModule],
  providers: [GovernanceAnalysisAccessFacade],
  exports: [GovernanceAnalysisAccessFacade]
})
export class GovernanceAnalysisAccessModule {}
