import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlExecutionPermitReceiptV1,
  Text2SqlExecutionReceiptV1,
  Text2SqlQueryContractV1,
  Text2SqlRepairReceiptV1,
  Text2SqlResultContractV1,
  Text2SqlResultReceiptV1,
  Text2SqlValidationReceiptV1
} from "@text2sql/shared-types";
import {
  createText2SqlAccuracyGateReceipt,
  createText2SqlResultReceipt,
  sealPassedText2SqlValidationReceipt
} from "../contracts/text2sql-v2.types";

export interface Text2SqlResultValidationResult {
  status: "passed" | "failed";
  resultContract: Text2SqlResultContractV1;
  resultReceipt: Text2SqlResultReceiptV1;
  resultGateReceipt: Text2SqlAccuracyGateReceiptV1;
  validationReceipt?: Text2SqlValidationReceiptV1;
  reasonCodes: string[];
}

@Injectable()
export class ResultValidationService {
  validate(input: {
    queryContract: Text2SqlQueryContractV1;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    gateReceipts: Text2SqlAccuracyGateReceiptV1[];
    executionPermit: Text2SqlExecutionPermitReceiptV1;
    executionReceipt: Text2SqlExecutionReceiptV1;
    repairReceipts?: Text2SqlRepairReceiptV1[];
    issuedAt?: string;
  }): Text2SqlResultValidationResult {
    const issuedAt = input.issuedAt ?? new Date().toISOString();
    const resultContract = this.buildResultContract(input.queryContract);
    const normalizedColumns = input.columns.map((column) => this.normalize(column));
    const expectedColumns = input.queryContract.resultShape.columns.map((column) => column.name);
    const schemaMatched =
      normalizedColumns.length > 0 &&
      expectedColumns.every((expected) =>
        this.matchesExpectedColumn(this.normalize(expected), normalizedColumns)
      );
    const cardinalityPassed = this.validateCardinality(
      input.queryContract.resultShape.cardinality,
      input.rows.length
    );
    const finiteNumbers = input.rows.every((row) =>
      Object.values(row).every(
        (value) => typeof value !== "number" || Number.isFinite(value)
      )
    );
    const boundedOutput =
      input.executionReceipt.status === "passed" &&
      input.executionReceipt.rowCount === input.rows.length &&
      input.executionReceipt.cancelled === false;
    const resultDigest = this.hash(JSON.stringify(this.stableValue(input.rows)));
    const oracleVerdicts: Text2SqlResultReceiptV1["oracleVerdicts"] = [
      {
        oracleId: "schema-shape.v1",
        kind: "business_invariant",
        mandatory: true,
        passed: schemaMatched,
        evidenceRefs: [`result-schema:${this.hash(JSON.stringify(normalizedColumns))}`]
      },
      {
        oracleId: "cardinality.v1",
        kind: "business_invariant",
        mandatory: true,
        passed: cardinalityPassed,
        evidenceRefs: [`row-count:${input.rows.length}`]
      },
      {
        oracleId: "finite-numeric-values.v1",
        kind: "business_invariant",
        mandatory: true,
        passed: finiteNumbers,
        evidenceRefs: [`result:${resultDigest}`]
      },
      {
        oracleId: "bounded-output.v1",
        kind: "business_invariant",
        mandatory: true,
        passed: boundedOutput,
        evidenceRefs: [input.executionReceipt.receiptId]
      }
    ];
    const reasonCodes = [
      ...(schemaMatched ? [] : ["result_schema_mismatch"]),
      ...(cardinalityPassed ? [] : ["result_cardinality_mismatch"]),
      ...(finiteNumbers ? [] : ["result_non_finite_number"]),
      ...(boundedOutput ? [] : ["result_execution_binding_mismatch"])
    ];
    const passed = reasonCodes.length === 0;
    const resultReceipt = createText2SqlResultReceipt({
      permit: input.executionPermit,
      executionReceipt: input.executionReceipt,
      resultContractDigest: resultContract.digest,
      status: passed ? "passed" : "failed",
      resultDigest,
      schemaMatched,
      oracleVerdicts,
      reasonCodes,
      issuedAt
    });
    const resultGateReceipt = createText2SqlAccuracyGateReceipt({
      runId: input.executionPermit.runId,
      queryContractDigest: input.executionPermit.queryContractDigest,
      sqlDigest: input.executionPermit.sqlDigest,
      versions: input.executionPermit.versions,
      gate: "result",
      status: passed ? "passed" : "failed",
      capability: "available",
      reasonCodes: passed ? ["mandatory_result_oracles_passed"] : reasonCodes,
      evidenceRefs: [resultReceipt.receiptId],
      parentReceiptDigests: [input.executionReceipt.receiptDigest],
      issuedAt
    });
    const allGateReceipts = [...input.gateReceipts, resultGateReceipt];
    const validationReceipt = passed
      ? sealPassedText2SqlValidationReceipt({
          permit: input.executionPermit,
          gateReceipts: allGateReceipts,
          executionReceipt: input.executionReceipt,
          resultReceipt,
          repairReceipts: input.repairReceipts,
          sealedAt: issuedAt
        })
      : undefined;
    return {
      status: passed ? "passed" : "failed",
      resultContract,
      resultReceipt,
      resultGateReceipt,
      validationReceipt,
      reasonCodes
    };
  }

  private buildResultContract(
    queryContract: Text2SqlQueryContractV1
  ): Text2SqlResultContractV1 {
    const payload = {
      version: "result-contract.v1" as const,
      queryContractDigest: queryContract.digest,
      expectedShape: queryContract.resultShape,
      oracleIds: [
        "schema-shape.v1",
        "cardinality.v1",
        "finite-numeric-values.v1",
        "bounded-output.v1"
      ],
      businessInvariantIds: [
        "result_columns_match_query_contract",
        "result_cardinality_matches_query_contract",
        "result_contains_only_finite_numbers",
        "result_is_bound_to_completed_execution"
      ]
    };
    return {
      ...payload,
      digest: this.hash(JSON.stringify(this.stableValue(payload)))
    };
  }

  private validateCardinality(
    cardinality: Text2SqlQueryContractV1["resultShape"]["cardinality"],
    rowCount: number
  ): boolean {
    if (cardinality === "scalar" || cardinality === "single_row") {
      return rowCount === 1;
    }
    return rowCount >= 0;
  }

  private matchesExpectedColumn(expected: string, actual: string[]): boolean {
    if (actual.includes(expected)) {
      return true;
    }
    const aliases: Record<string, string[]> = {
      count: ["count", "total", "item_count", "row_count"],
      gmv: ["gmv", "amount", "total_amount", "total"],
      revenue: ["revenue", "amount", "total_amount", "total"],
      amount: ["amount", "total_amount", "total"]
    };
    return (aliases[expected] ?? []).some((alias) => actual.includes(alias));
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().split(".").at(-1) ?? value.trim().toLowerCase();
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private stableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.stableValue(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.stableValue(item)])
      );
    }
    return value;
  }
}
