import { Module } from "@nestjs/common";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { DatasourceAccessPolicyService } from "./datasource-access-policy.service";
import { PolicyEvaluatorService } from "./policy-evaluator.service";

@Module({
  imports: [PlatformDataPersistenceModule],
  providers: [DatasourceAccessPolicyService, PolicyEvaluatorService],
  exports: [DatasourceAccessPolicyService, PolicyEvaluatorService]
})
export class GovernanceAccessModule {}
