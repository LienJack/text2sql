import { Injectable } from "@nestjs/common";
import type {
  DatasourceType,
  SemanticPlanV1,
  SqlValidationArtifactV1,
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlEvalVersionTupleV1
} from "@text2sql/shared-types";
import type { SqlTableAccessContext } from "../../platform/data/query";
import type { DatasourceSchemaSnapshotV1 } from "../../platform/data/schema/schema-snapshot.types";
import {
  SqlValidationService,
  type SqlValidationOutcome
} from "../adapters/sql-validation.service";
import type { StructuredSqlGenerationArtifact } from "../agent/sql/sql-generation.service";
import { createText2SqlAccuracyGateReceipt } from "../contracts/text2sql-v2.types";

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
    schemaSnapshot?: DatasourceSchemaSnapshotV1;
    requiresCatalog?: boolean;
    runId?: string;
    accuracyVersions?: Text2SqlEvalVersionTupleV1;
    requiresAccuracyReceipts?: boolean;
  }): Promise<ValidateSqlNodeResult> {
    const sql = input.sqlArtifact?.sql ?? input.sql ?? "";
    const artifact = await this.sqlValidationService.validate({
      sql,
      datasourceId: input.datasourceId,
      datasourceType: input.datasourceType,
      semanticPlan: input.semanticPlan,
      sqlArtifact: input.sqlArtifact,
      accessContext: input.accessContext,
      allowedTables: input.allowedTables,
      schemaSnapshot: input.schemaSnapshot,
      requiresCatalog: input.requiresCatalog
    });

    const withAccuracy = this.attachAccuracyReceipts({
      artifact,
      semanticPlan: input.semanticPlan,
      accessContext: input.accessContext,
      runId: input.runId,
      versions: input.accuracyVersions,
      required: Boolean(input.requiresAccuracyReceipts)
    });

    return {
      outcome: this.sqlValidationService.resolveOutcome(withAccuracy),
      artifact: withAccuracy
    };
  }

  private attachAccuracyReceipts(input: {
    artifact: SqlValidationArtifactV1;
    semanticPlan?: SemanticPlanV1;
    accessContext?: SqlTableAccessContext;
    runId?: string;
    versions?: Text2SqlEvalVersionTupleV1;
    required: boolean;
  }): SqlValidationArtifactV1 {
    const queryContract = input.semanticPlan?.queryContract;
    const sqlDigest = input.artifact.sqlAnalysis?.normalizedSqlDigest;
    if (!queryContract || !sqlDigest || !input.runId || !input.versions) {
      return input.artifact;
    }
    const issuedAt = new Date().toISOString();
    const base = {
      runId: input.runId,
      queryContractDigest: queryContract.digest,
      sqlDigest,
      versions: input.versions,
      issuedAt
    };
    const receipts: Text2SqlAccuracyGateReceiptV1[] = [];
    const add = (
      gate: "intent" | "semantic" | "structural" | "policy",
      pass: boolean,
      capability: boolean,
      reasonCodes: string[],
      evidenceRefs: string[]
    ) => {
      receipts.push(
        createText2SqlAccuracyGateReceipt({
          ...base,
          gate,
          status: capability ? (pass ? "passed" : "failed") : "unavailable",
          capability: capability ? "available" : "unavailable",
          reasonCodes,
          evidenceRefs,
          parentReceiptDigests: receipts.map((receipt) => receipt.receiptDigest)
        })
      );
    };
    add(
      "intent",
      queryContract.runId === input.runId && queryContract.route === "text_to_sql",
      true,
      queryContract.runId === input.runId
        ? ["query_contract_bound"]
        : ["query_contract_run_mismatch"],
      [queryContract.id]
    );
    const ledger = input.semanticPlan?.planLedger?.summary;
    const failedLedgerIds = ledger?.failedHardBlockerIds ?? [];
    add(
      "semantic",
      failedLedgerIds.length === 0,
      Boolean(input.semanticPlan?.planLedger),
      failedLedgerIds.length > 0
        ? ["plan_ledger_hard_blocker_failed"]
        : ["plan_ledger_fulfilled"],
      input.semanticPlan?.evidenceRefs ?? []
    );
    const structuralChecks = input.artifact.checks.filter((check) =>
      check.check === "structural" || check.check === "catalog"
    );
    const structuralCapability =
      structuralChecks.length === 2 &&
      structuralChecks.every((check) => check.status !== "skipped");
    add(
      "structural",
      structuralChecks.every((check) => check.status === "passed"),
      structuralCapability,
      structuralChecks.flatMap((check) => check.reasonCodes ?? [check.code ?? check.check]),
      [
        `sql-analysis:${sqlDigest}`,
        ...(input.artifact.catalogResolution?.schemaSnapshotId
          ? [`schema-snapshot:${input.artifact.catalogResolution.schemaSnapshotId}`]
          : [])
      ]
    );
    const policyCapability = Boolean(
      input.accessContext?.policyDigest &&
        Number.isInteger(input.accessContext.policyVersion) &&
        input.artifact.catalogResolution?.status === "resolved"
    );
    const permissionCheck = input.artifact.checks.find(
      (check) => check.check === "permission"
    );
    add(
      "policy",
      permissionCheck?.status === "passed",
      policyCapability,
      permissionCheck?.status === "passed"
        ? ["execution_policy_bound"]
        : [permissionCheck?.code ?? "policy_receipt_unavailable"],
      input.accessContext?.policyDigest
        ? [`policy:${input.accessContext.policyDigest}`]
        : []
    );
    if (
      input.required &&
      receipts.some((receipt) => receipt.status !== "passed") &&
      input.artifact.status === "passed"
    ) {
      return {
        ...input.artifact,
        status: "failed",
        correctable: false,
        failure: {
          code: "SQL_ACCURACY_PRE_EXECUTION_GATE_FAILED",
          message: "Accuracy pre-execution receipts are incomplete.",
          category: "validation",
          terminal: true,
          correctable: false
        },
        accuracy: {
          version: "accuracy-validation-evidence.v1",
          queryContractDigest: queryContract.digest,
          sqlDigest,
          gateReceipts: receipts
        }
      };
    }
    return {
      ...input.artifact,
      accuracy: {
        version: "accuracy-validation-evidence.v1",
        queryContractDigest: queryContract.digest,
        sqlDigest,
        gateReceipts: receipts
      }
    };
  }
}
