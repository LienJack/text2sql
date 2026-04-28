import { Injectable } from "@nestjs/common";
import type {
  DatasourceType,
  SemanticPlanV1,
  SqlValidationArtifactV1
} from "@text2sql/shared-types";
import type { SqlTableAccessContext } from "../../../platform/data/query";
import {
  SqlValidationService,
  type SqlValidationOutcome
} from "../../adapters/text2sql-v2/sql-validation.service";
import type { StructuredSqlGenerationArtifact } from "../../agent/sql/sql-generation.service";

export interface ValidateSqlNodeResult {
  outcome: SqlValidationOutcome;
  artifact: SqlValidationArtifactV1;
}

@Injectable()
export class ValidateSqlNode {
  constructor(private readonly sqlValidationService: SqlValidationService) {}

  async run(input: {
    sql?: string;
    sqlArtifact?: StructuredSqlGenerationArtifact;
    datasourceId?: string;
    datasourceType?: DatasourceType;
    semanticPlan?: SemanticPlanV1;
    accessContext?: SqlTableAccessContext;
    allowedTables?: string[];
  }): Promise<ValidateSqlNodeResult> {
    const sql = input.sqlArtifact?.sql ?? input.sql ?? "";
    const artifact = await this.sqlValidationService.validate({
      sql,
      datasourceId: input.datasourceId,
      datasourceType: input.datasourceType,
      semanticPlan: input.semanticPlan,
      accessContext: input.accessContext,
      allowedTables: input.allowedTables
    });

    return {
      outcome: this.sqlValidationService.resolveOutcome(artifact),
      artifact
    };
  }
}
