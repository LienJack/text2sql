import { Injectable } from "@nestjs/common";
import type {
  SemanticContextPackV1,
  SemanticPlanV1
} from "@text2sql/shared-types";
import type { SqlSemanticIntent } from "../../agent/sql/sql-prompt.builder";
import {
  SemanticPlanService,
  type BuildSemanticPlanInput
} from "../../adapters/text2sql-v2/semantic-plan.service";
import type { SemanticPlanValidationResult } from "../../adapters/text2sql-v2/semantic-plan.validator";

export type SemanticPlanNodeRoute =
  | "ready"
  | "needs_clarification"
  | "direct_answer"
  | "fail_closed";

export interface SemanticPlanNodeResult {
  route: SemanticPlanNodeRoute;
  plan: SemanticPlanV1;
  validation: SemanticPlanValidationResult;
}

@Injectable()
export class SemanticPlanNode {
  constructor(private readonly semanticPlanService: SemanticPlanService) {}

  run(
    input: BuildSemanticPlanInput & {
      contextPack: SemanticContextPackV1;
      semanticIntent?: SqlSemanticIntent;
    }
  ): SemanticPlanNodeResult {
    const result = this.semanticPlanService.build(input);
    return {
      route: result.validation.outcome,
      plan: result.plan,
      validation: result.validation
    };
  }
}
