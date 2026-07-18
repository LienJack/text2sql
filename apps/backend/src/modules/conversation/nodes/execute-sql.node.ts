import { Injectable } from "@nestjs/common";
import type {
  DatasourceType,
  SemanticPlanV1,
  SqlValidationArtifactV1,
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlExecutionPermitReceiptV1,
  Text2SqlExecutionReceiptV1,
  Text2SqlRepairReceiptV1,
  Text2SqlResultContractV1,
  Text2SqlResultReceiptV1,
  Text2SqlValidationReceiptV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import {
  BoundedQueryExecutionService,
  type SqlTableAccessContext
} from "../../platform/data/query";
import { ExecuteSqlNode as LegacyExecuteSqlNode } from "../agent/nodes/execute-sql.node";
import type { StructuredSqlGenerationArtifact } from "../agent/sql/sql-generation.service";
import { ResultValidationService } from "../adapters/result-validation.service";

export interface ExecuteSqlNodeResult {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  rowCount: number;
  byteCount?: number;
  emptyResult: boolean;
  resourceGateReceipt?: Text2SqlAccuracyGateReceiptV1;
  sandboxGateReceipt?: Text2SqlAccuracyGateReceiptV1;
  executionPermit?: Text2SqlExecutionPermitReceiptV1;
  executionReceipt?: Text2SqlExecutionReceiptV1;
  resultContract?: Text2SqlResultContractV1;
  resultReceipt?: Text2SqlResultReceiptV1;
  resultGateReceipt?: Text2SqlAccuracyGateReceiptV1;
  validationReceipt?: Text2SqlValidationReceiptV1;
}

@Injectable()
export class ExecuteSqlNode {
  constructor(
    private readonly executeSqlNode: LegacyExecuteSqlNode,
    private readonly boundedExecution: BoundedQueryExecutionService = new BoundedQueryExecutionService(),
    private readonly resultValidation: ResultValidationService = new ResultValidationService()
  ) {}

  async run(input: {
    sqlArtifact?: StructuredSqlGenerationArtifact;
    sql?: string;
    validationArtifact: SqlValidationArtifactV1;
    datasourceId: string;
    sessionId: string;
    requestId?: string;
    accessContext?: SqlTableAccessContext;
    semanticPlan?: SemanticPlanV1;
    datasourceType?: DatasourceType;
    runId?: string;
    accuracyVersions?: Text2SqlEvalVersionTupleV1;
    accuracyGateReceipts?: Text2SqlAccuracyGateReceiptV1[];
    repairReceipts?: Text2SqlRepairReceiptV1[];
    abortSignal?: AbortSignal;
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

    const queryContract = input.semanticPlan?.queryContract;
    if (
      queryContract &&
      input.runId &&
      input.accuracyVersions &&
      input.accuracyGateReceipts &&
      input.datasourceType
    ) {
      const result = await this.boundedExecution.execute({
        runId: input.runId,
        datasourceId: input.datasourceId,
        datasourceType: input.datasourceType,
        sql,
        queryContractDigest: queryContract.digest,
        versions: input.accuracyVersions,
        gateReceipts: input.accuracyGateReceipts,
        accessContext: input.accessContext,
        allowedTables: input.accessContext?.allowedTables,
        abortSignal: input.abortSignal,
        requireExplain: true,
        preflight: ({ sql: boundedSql, abortSignal, timeoutMs }) =>
          this.executeSqlNode.preflight({
            sql: boundedSql,
            datasourceId: input.datasourceId,
            abortSignal,
            timeoutMs
          }),
        execute: ({ sql: boundedSql, abortSignal }) =>
          this.executeSqlNode.run({
            sql: boundedSql,
            sqlArtifact: input.sqlArtifact,
            datasourceId: input.datasourceId,
            sessionId: input.sessionId,
            requestId: input.requestId,
            accessContext: input.accessContext,
            semanticPlan: input.semanticPlan,
            abortSignal
          })
      });
      const gateReceipts = [
        ...input.accuracyGateReceipts,
        result.resourceGateReceipt,
        result.sandboxGateReceipt
      ];
      const resultValidation = this.resultValidation.validate({
        queryContract,
        columns: result.columns,
        rows: result.rows,
        gateReceipts,
        executionPermit: result.executionPermit,
        executionReceipt: result.executionReceipt,
        repairReceipts: input.repairReceipts
      });
      if (resultValidation.status !== "passed" || !resultValidation.validationReceipt) {
        throw new DomainError(
          "SQL_RESULT_VALIDATION_FAILED",
          "Execution completed but deterministic result validation failed.",
          422,
          {
            reasonCodes: resultValidation.reasonCodes,
            resultReceipt: resultValidation.resultReceipt,
            resultGateReceipt: resultValidation.resultGateReceipt
          }
        );
      }
      return {
        rows: result.rows,
        columns: result.columns,
        rowCount: result.rowCount,
        byteCount: result.byteCount,
        emptyResult: result.rowCount === 0,
        resourceGateReceipt: result.resourceGateReceipt,
        sandboxGateReceipt: result.sandboxGateReceipt,
        executionPermit: result.executionPermit,
        executionReceipt: result.executionReceipt,
        resultContract: resultValidation.resultContract,
        resultReceipt: resultValidation.resultReceipt,
        resultGateReceipt: resultValidation.resultGateReceipt,
        validationReceipt: resultValidation.validationReceipt
      };
    }

    const result = await this.executeSqlNode.run({
      sql,
      sqlArtifact: input.sqlArtifact,
      datasourceId: input.datasourceId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      accessContext: input.accessContext,
      semanticPlan: input.semanticPlan,
      abortSignal: input.abortSignal
    });

    return {
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rows.length,
      emptyResult: result.rows.length === 0
    };
  }
}
