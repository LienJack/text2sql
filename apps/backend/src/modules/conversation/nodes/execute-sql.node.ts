import { Injectable } from "@nestjs/common";
import type {
  SemanticPlanV1,
  SqlValidationArtifactV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import type { SqlTableAccessContext } from "../../platform/data/query";
import { ExecuteSqlNode as LegacyExecuteSqlNode } from "../agent/nodes/execute-sql.node";
import type { StructuredSqlGenerationArtifact } from "../agent/sql/sql-generation.service";

export interface ExecuteSqlNodeResult {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  rowCount: number;
  emptyResult: boolean;
}

@Injectable()
export class ExecuteSqlNode {
  constructor(private readonly executeSqlNode: LegacyExecuteSqlNode) {}

  async run(input: {
    sqlArtifact?: StructuredSqlGenerationArtifact;
    sql?: string;
    validationArtifact: SqlValidationArtifactV1;
    datasourceId: string;
    sessionId: string;
    requestId?: string;
    accessContext?: SqlTableAccessContext;
    semanticPlan?: SemanticPlanV1;
  }): Promise<ExecuteSqlNodeResult> {
    if (input.validationArtifact.status !== "passed") {
      throw new DomainError(
        "SQL_EXECUTE_PRECONDITION_FAILED",
        "execute-sql node requires a passed validation artifact",
        422,
        {
          validationArtifact: input.validationArtifact
        }
      );
    }

    const sql = input.sqlArtifact?.sql ?? input.sql;
    if (!sql?.trim()) {
      throw new DomainError(
        "SQL_EXECUTE_PRECONDITION_FAILED",
        "execute-sql node requires SQL before execution",
        422
      );
    }

    const result = await this.executeSqlNode.run({
      sql,
      datasourceId: input.datasourceId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      accessContext: input.accessContext,
      semanticPlan: input.semanticPlan
    });

    return {
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rows.length,
      emptyResult: result.rows.length === 0
    };
  }
}
