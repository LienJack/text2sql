import { Injectable } from "@nestjs/common";
import { PolicyEvaluatorService } from "./access/policy-evaluator.service";
import { DatasourceRegistryService } from "./datasource/datasource-registry.service";
import { DatasourceService } from "./datasource/datasource.service";

@Injectable()
export class GovernanceChatAccessFacade {
  constructor(
    readonly datasourceService: DatasourceService,
    readonly datasourceRegistryService: DatasourceRegistryService,
    readonly policyEvaluatorService: PolicyEvaluatorService
  ) {}
}
