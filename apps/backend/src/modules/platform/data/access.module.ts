import { Module } from "@nestjs/common";
import { DatasourceAccessPolicyService } from "../../governance/access/datasource-access-policy.service";
import { PolicyEvaluatorService } from "../../governance/access/policy-evaluator.service";
import { PlatformDataPersistenceModule } from "./persistence.module";

@Module({
  imports: [PlatformDataPersistenceModule],
  providers: [DatasourceAccessPolicyService, PolicyEvaluatorService],
  exports: [DatasourceAccessPolicyService, PolicyEvaluatorService]
})
export class PlatformDataAccessModule {}
