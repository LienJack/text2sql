import type {
  SemanticContextPackV1,
  SemanticPlanV1,
  Text2SqlAccuracyEvidenceV1,
  Text2SqlAccuracyGateKindV1,
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlClosureReceiptV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlExecutionPermitReceiptV1,
  Text2SqlExecutionReceiptV1,
  Text2SqlPolicyReceiptV1,
  Text2SqlRepairReceiptV1,
  Text2SqlResultReceiptV1,
  Text2SqlValidationReceiptV1,
  Text2SqlV2ArtifactRefV1,
  SqlGenerationArtifactV1,
  SqlValidationArtifactV1,
  Text2SqlV2RunArtifact,
  Text2SqlV2RuntimePlanV1,
  Text2SqlV2SmartDefaultsEvidenceV1,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName
} from "@text2sql/shared-types";
import { createHash } from "node:crypto";
import {
  TEXT2SQL_PRE_EXECUTION_GATE_ORDER,
  assertText2SqlAccuracyGateReceiptDigest,
  assertText2SqlExecutionPermitBinding
} from "../../platform/accuracy/text2sql-accuracy-receipt.factory";

export {
  TEXT2SQL_PRE_EXECUTION_GATE_ORDER,
  assertText2SqlExecutionPermitBinding,
  createText2SqlAccuracyGateReceipt,
  createText2SqlExecutionPermitReceipt,
  createText2SqlExecutionReceipt
} from "../../platform/accuracy/text2sql-accuracy-receipt.factory";

export const TEXT2SQL_V2_STAGE_ORDER: Text2SqlV2StageName[] = [
  "intake",
  "retrieve",
  "assemble-context",
  "semantic-plan",
  "generate-sql",
  "validate",
  "correct",
  "execute",
  "answer"
];

const TEXT2SQL_FINAL_GATE_ORDER = [
  ...TEXT2SQL_PRE_EXECUTION_GATE_ORDER,
  "sandbox",
  "result"
] as const satisfies readonly Text2SqlAccuracyGateKindV1[];

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
};

const receiptDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");

const versionsMatch = (
  left: Text2SqlEvalVersionTupleV1,
  right: Text2SqlEvalVersionTupleV1
): boolean => JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));

const assertReceiptBinding = (
  receipt: {
    runId: string;
    queryContractDigest: string;
    sqlDigest?: string;
    versions: Text2SqlEvalVersionTupleV1;
  },
  expected: {
    runId: string;
    queryContractDigest: string;
    sqlDigest: string;
    versions: Text2SqlEvalVersionTupleV1;
  }
): void => {
  if (receipt.runId !== expected.runId) {
    throw new Error("accuracy_receipt_run_mismatch");
  }
  if (receipt.queryContractDigest !== expected.queryContractDigest) {
    throw new Error("accuracy_receipt_query_contract_mismatch");
  }
  if (receipt.sqlDigest !== expected.sqlDigest) {
    throw new Error("accuracy_receipt_sql_mismatch");
  }
  if (!versionsMatch(receipt.versions, expected.versions)) {
    throw new Error("accuracy_receipt_version_mismatch");
  }
};

export function createText2SqlPolicyReceipt(input: {
  runId: string;
  queryContractDigest: string;
  versions: Text2SqlEvalVersionTupleV1;
  workspaceId: string;
  datasourceId: string;
  workspaceDatasourceBindingId: string;
  policyVersion: string;
  allowedTables: string[];
  schemaSnapshotDigest: string;
  status: Text2SqlPolicyReceiptV1["status"];
  reasonCodes?: string[];
  issuedAt: string;
}): Text2SqlPolicyReceiptV1 {
  const unsigned = {
    version: "policy-receipt.v1" as const,
    runId: input.runId,
    queryContractDigest: input.queryContractDigest,
    versions: input.versions,
    workspaceId: input.workspaceId,
    datasourceId: input.datasourceId,
    workspaceDatasourceBindingId: input.workspaceDatasourceBindingId,
    policyVersion: input.policyVersion,
    allowedTables: [...input.allowedTables].sort(),
    schemaSnapshotDigest: input.schemaSnapshotDigest,
    status: input.status,
    reasonCodes: [...(input.reasonCodes ?? [])],
    issuedAt: input.issuedAt
  };
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptId: `policy:${digest}`,
    receiptDigest: digest
  };
}

export function createText2SqlClosureReceipt(input: {
  runId: string;
  queryContractDigest: string;
  versions: Text2SqlEvalVersionTupleV1;
  status: Text2SqlClosureReceiptV1["status"];
  conflictSet?: Text2SqlClosureReceiptV1["conflictSet"];
  joinClosure?: string[];
  metricDependencies?: string[];
  calculatedDependencies?: string[];
  filterDependencies?: string[];
  timeDependencies?: string[];
  mandatoryEvidenceRefs?: string[];
  optionalEvidenceRefs?: string[];
  reasonCodes?: string[];
  issuedAt: string;
}): Text2SqlClosureReceiptV1 {
  const unsigned = {
    version: "closure-receipt.v1" as const,
    runId: input.runId,
    queryContractDigest: input.queryContractDigest,
    versions: input.versions,
    status: input.status,
    conflictSet: [...(input.conflictSet ?? [])],
    joinClosure: [...(input.joinClosure ?? [])],
    metricDependencies: [...(input.metricDependencies ?? [])],
    calculatedDependencies: [...(input.calculatedDependencies ?? [])],
    filterDependencies: [...(input.filterDependencies ?? [])],
    timeDependencies: [...(input.timeDependencies ?? [])],
    mandatoryEvidenceRefs: [...(input.mandatoryEvidenceRefs ?? [])],
    optionalEvidenceRefs: [...(input.optionalEvidenceRefs ?? [])],
    reasonCodes: [...(input.reasonCodes ?? [])],
    issuedAt: input.issuedAt
  };
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptId: `closure:${digest}`,
    receiptDigest: digest
  };
}

export function createText2SqlResultReceipt(input: {
  permit: Text2SqlExecutionPermitReceiptV1;
  executionReceipt: Text2SqlExecutionReceiptV1;
  resultContractDigest: string;
  status: Text2SqlResultReceiptV1["status"];
  resultDigest?: string;
  schemaMatched: boolean;
  oracleVerdicts: Text2SqlResultReceiptV1["oracleVerdicts"];
  reasonCodes?: string[];
  issuedAt: string;
}): Text2SqlResultReceiptV1 {
  const expected = {
    runId: input.permit.runId,
    queryContractDigest: input.permit.queryContractDigest,
    sqlDigest: input.permit.sqlDigest,
    versions: input.permit.versions
  };
  assertText2SqlExecutionPermitBinding(input.permit, expected);
  assertReceiptBinding(input.executionReceipt, expected);
  if (input.executionReceipt.executionPermitDigest !== input.permit.receiptDigest) {
    throw new Error("result_receipt_execution_permit_mismatch");
  }
  if (input.status === "passed") {
    if (input.executionReceipt.status !== "passed") {
      throw new Error("result_receipt_execution_not_passed");
    }
    if (!input.schemaMatched) {
      throw new Error("result_receipt_schema_not_matched");
    }
    if (input.oracleVerdicts.some((oracle) => oracle.mandatory && !oracle.passed)) {
      throw new Error("result_receipt_mandatory_oracle_failed");
    }
  }
  const unsigned = {
    version: "result-receipt.v1" as const,
    runId: input.permit.runId,
    queryContractDigest: input.permit.queryContractDigest,
    sqlDigest: input.permit.sqlDigest,
    versions: input.permit.versions,
    executionReceiptDigest: input.executionReceipt.receiptDigest,
    resultContractDigest: input.resultContractDigest,
    status: input.status,
    ...(input.resultDigest ? { resultDigest: input.resultDigest } : {}),
    schemaMatched: input.schemaMatched,
    oracleVerdicts: input.oracleVerdicts,
    reasonCodes: [...(input.reasonCodes ?? [])],
    issuedAt: input.issuedAt
  };
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptId: `result:${digest}`,
    receiptDigest: digest
  };
}

export function createText2SqlRepairReceipt(input: {
  runId: string;
  queryContractDigest: string;
  versions: Text2SqlEvalVersionTupleV1;
  parentSqlDigest: string;
  patchedSqlDigest: string;
  patchId: string;
  patchKind: Text2SqlRepairReceiptV1["patchKind"];
  equivalenceStatus: Text2SqlRepairReceiptV1["equivalenceStatus"];
  attempt: 1 | 2;
  changedSemanticDimensions?: string[];
  reasonCodes?: string[];
  issuedAt: string;
}): Text2SqlRepairReceiptV1 {
  if (!Number.isFinite(Date.parse(input.issuedAt))) {
    throw new Error("repair_receipt_time_invalid");
  }
  if (input.equivalenceStatus === "proven" && input.parentSqlDigest === input.patchedSqlDigest) {
    throw new Error("repair_receipt_no_progress");
  }
  const unsigned = {
    version: "repair-receipt.v1" as const,
    runId: input.runId,
    queryContractDigest: input.queryContractDigest,
    versions: input.versions,
    parentSqlDigest: input.parentSqlDigest,
    patchedSqlDigest: input.patchedSqlDigest,
    patchId: input.patchId,
    patchKind: input.patchKind,
    equivalenceStatus: input.equivalenceStatus,
    attempt: input.attempt,
    changedSemanticDimensions: [...(input.changedSemanticDimensions ?? [])],
    reasonCodes: [...(input.reasonCodes ?? [])],
    issuedAt: input.issuedAt
  };
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptId: `repair:${digest}`,
    receiptDigest: digest
  };
}

export function sealPassedText2SqlValidationReceipt(input: {
  permit: Text2SqlExecutionPermitReceiptV1;
  gateReceipts: Text2SqlAccuracyGateReceiptV1[];
  executionReceipt: Text2SqlExecutionReceiptV1;
  resultReceipt: Text2SqlResultReceiptV1;
  repairReceipts?: Text2SqlRepairReceiptV1[];
  sealedAt: string;
}): Text2SqlValidationReceiptV1 {
  const expectedBinding = {
    runId: input.permit.runId,
    queryContractDigest: input.permit.queryContractDigest,
    sqlDigest: input.permit.sqlDigest,
    versions: input.permit.versions
  };
  const byGate = new Map(input.gateReceipts.map((item) => [item.gate, item]));
  for (const gate of TEXT2SQL_FINAL_GATE_ORDER) {
    const receipt = byGate.get(gate);
    if (!receipt) {
      throw new Error(`validation_receipt_gate_missing:${gate}`);
    }
    assertText2SqlAccuracyGateReceiptDigest(receipt);
    assertReceiptBinding(receipt, expectedBinding);
    if (receipt.status !== "passed" || receipt.capability !== "available") {
      throw new Error(`validation_receipt_gate_not_passed:${gate}`);
    }
  }
  assertReceiptBinding(input.executionReceipt, expectedBinding);
  assertReceiptBinding(input.resultReceipt, expectedBinding);
  if (input.executionReceipt.status !== "passed") {
    throw new Error("validation_receipt_execution_not_passed");
  }
  if (input.resultReceipt.status !== "passed") {
    throw new Error("validation_receipt_result_not_passed");
  }
  if (input.executionReceipt.executionPermitDigest !== input.permit.receiptDigest) {
    throw new Error("validation_receipt_permit_mismatch");
  }
  if (input.resultReceipt.executionReceiptDigest !== input.executionReceipt.receiptDigest) {
    throw new Error("validation_receipt_execution_mismatch");
  }
  let priorPatchedSqlDigest: string | undefined;
  const repairReceipts = input.repairReceipts ?? [];
  const repairReceiptDigests = repairReceipts.map((receipt) => {
    if (
      receipt.runId !== expectedBinding.runId ||
      receipt.queryContractDigest !== expectedBinding.queryContractDigest ||
      !versionsMatch(receipt.versions, expectedBinding.versions)
    ) {
      throw new Error("validation_receipt_repair_binding_mismatch");
    }
    const {
      receiptId: _repairReceiptId,
      receiptDigest: actualRepairDigest,
      ...unsignedRepairReceipt
    } = receipt;
    if (receiptDigest(unsignedRepairReceipt) !== actualRepairDigest) {
      throw new Error("validation_receipt_repair_digest_invalid");
    }
    if (receipt.equivalenceStatus !== "proven") {
      throw new Error("validation_receipt_repair_not_proven");
    }
    if (priorPatchedSqlDigest && receipt.parentSqlDigest !== priorPatchedSqlDigest) {
      throw new Error("validation_receipt_repair_chain_broken");
    }
    priorPatchedSqlDigest = receipt.patchedSqlDigest;
    return receipt.receiptDigest;
  });
  if (
    repairReceipts.length > 0 &&
    repairReceipts.at(-1)?.patchedSqlDigest !== expectedBinding.sqlDigest
  ) {
    throw new Error("validation_receipt_repair_final_sql_mismatch");
  }
  const unsigned = {
    version: "validation-receipt.v1" as const,
    runId: input.permit.runId,
    queryContractDigest: input.permit.queryContractDigest,
    sqlDigest: input.permit.sqlDigest,
    versions: input.permit.versions,
    status: "passed" as const,
    gateReceiptDigests: TEXT2SQL_FINAL_GATE_ORDER.map(
      (gate) => byGate.get(gate)!.receiptDigest
    ),
    executionPermitDigest: input.permit.receiptDigest,
    executionReceiptDigest: input.executionReceipt.receiptDigest,
    resultReceiptDigest: input.resultReceipt.receiptDigest,
    repairReceiptDigests,
    reasonCodes: [] as string[],
    sealedAt: input.sealedAt
  };
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptId: `validation:${digest}`,
    receiptDigest: digest
  };
}

export interface Text2SqlV2RunContext {
  runId: string;
  sessionId: string;
  question: string;
}

export interface Text2SqlV2StateMachineResult {
  stages: Text2SqlV2StageArtifact[];
  contextPack?: SemanticContextPackV1;
  semanticPlan?: SemanticPlanV1;
  sqlGeneration?: SqlGenerationArtifactV1;
  sqlValidation?: SqlValidationArtifactV1;
  runtimePlan?: Text2SqlV2RuntimePlanV1;
  artifactRefs?: Text2SqlV2ArtifactRefV1[];
  smartDefaults?: Text2SqlV2SmartDefaultsEvidenceV1;
  accuracy?: Text2SqlAccuracyEvidenceV1;
}

export type Text2SqlV2MutableRunArtifact = Omit<Text2SqlV2RunArtifact, "version"> & {
  version: "v2";
};
