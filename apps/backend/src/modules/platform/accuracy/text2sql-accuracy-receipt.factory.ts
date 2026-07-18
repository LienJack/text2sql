import { createHash } from "node:crypto";
import type {
  Text2SqlAccuracyGateKindV1,
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlExecutionPermitReceiptV1,
  Text2SqlExecutionReceiptV1
} from "@text2sql/shared-types";

export const TEXT2SQL_PRE_EXECUTION_GATE_ORDER = [
  "intent",
  "semantic",
  "structural",
  "policy",
  "resource"
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

export const assertText2SqlAccuracyGateReceiptDigest = (
  receipt: Text2SqlAccuracyGateReceiptV1
): void => {
  const { receiptId: _receiptId, receiptDigest: actualDigest, ...unsigned } = receipt;
  if (receiptDigest(unsigned) !== actualDigest) {
    throw new Error(`accuracy_gate_receipt_digest_invalid:${receipt.gate}`);
  }
};

export function createText2SqlAccuracyGateReceipt(input: {
  runId: string;
  queryContractDigest: string;
  sqlDigest: string;
  versions: Text2SqlEvalVersionTupleV1;
  gate: Text2SqlAccuracyGateKindV1;
  status: Text2SqlAccuracyGateReceiptV1["status"];
  capability: Text2SqlAccuracyGateReceiptV1["capability"];
  reasonCodes?: string[];
  evidenceRefs?: string[];
  parentReceiptDigests?: string[];
  issuedAt: string;
}): Text2SqlAccuracyGateReceiptV1 {
  if (
    (input.status === "unavailable") !== (input.capability === "unavailable")
  ) {
    throw new Error("accuracy_gate_capability_status_inconsistent");
  }
  const unsigned = {
    version: "accuracy-gate-receipt.v1" as const,
    runId: input.runId,
    queryContractDigest: input.queryContractDigest,
    sqlDigest: input.sqlDigest,
    versions: input.versions,
    gate: input.gate,
    status: input.status,
    capability: input.capability,
    reasonCodes: [...(input.reasonCodes ?? [])],
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    parentReceiptDigests: [...(input.parentReceiptDigests ?? [])],
    issuedAt: input.issuedAt
  };
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptId: `accuracy-gate:${input.gate}:${digest}`,
    receiptDigest: digest
  };
}

export function createText2SqlExecutionPermitReceipt(input: {
  runId: string;
  queryContractDigest: string;
  sqlDigest: string;
  versions: Text2SqlEvalVersionTupleV1;
  gateReceipts: Text2SqlAccuracyGateReceiptV1[];
  issuedAt: string;
  expiresAt: string;
}): Text2SqlExecutionPermitReceiptV1 {
  if (
    !Number.isFinite(Date.parse(input.issuedAt)) ||
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)
  ) {
    throw new Error("execution_permit_time_invalid");
  }
  const expectedBinding = {
    runId: input.runId,
    queryContractDigest: input.queryContractDigest,
    sqlDigest: input.sqlDigest,
    versions: input.versions
  };
  const byGate = new Map<Text2SqlAccuracyGateKindV1, Text2SqlAccuracyGateReceiptV1>();
  for (const receipt of input.gateReceipts) {
    if (byGate.has(receipt.gate)) {
      throw new Error(`execution_permit_gate_duplicate:${receipt.gate}`);
    }
    byGate.set(receipt.gate, receipt);
  }
  const gateReceiptDigests = Object.fromEntries(
    TEXT2SQL_PRE_EXECUTION_GATE_ORDER.map((gate) => {
      const receipt = byGate.get(gate);
      if (!receipt) {
        throw new Error(`execution_permit_gate_missing:${gate}`);
      }
      assertText2SqlAccuracyGateReceiptDigest(receipt);
      assertReceiptBinding(receipt, expectedBinding);
      if (receipt.status !== "passed" || receipt.capability !== "available") {
        throw new Error(`execution_permit_gate_not_passed:${gate}`);
      }
      return [gate, receipt.receiptDigest];
    })
  ) as Text2SqlExecutionPermitReceiptV1["gateReceiptDigests"];
  const unsigned = {
    version: "execution-permit-receipt.v1" as const,
    runId: input.runId,
    queryContractDigest: input.queryContractDigest,
    sqlDigest: input.sqlDigest,
    versions: input.versions,
    status: "passed" as const,
    gateReceiptDigests,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  };
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptId: `execution-permit:${digest}`,
    receiptDigest: digest
  };
}

export function assertText2SqlExecutionPermitBinding(
  permit: Text2SqlExecutionPermitReceiptV1,
  expected: {
    runId: string;
    queryContractDigest: string;
    sqlDigest: string;
    versions: Text2SqlEvalVersionTupleV1;
    now?: Date;
  }
): void {
  assertReceiptBinding(permit, expected);
  const { receiptId: _receiptId, receiptDigest: actualDigest, ...unsigned } = permit;
  if (receiptDigest(unsigned) !== actualDigest) {
    throw new Error("execution_permit_digest_invalid");
  }
  const now = expected.now ?? new Date();
  if (Date.parse(permit.expiresAt) <= now.getTime()) {
    throw new Error("execution_permit_expired");
  }
}

export function createText2SqlExecutionReceipt(input: {
  permit: Text2SqlExecutionPermitReceiptV1;
  sandboxGateReceipt: Text2SqlAccuracyGateReceiptV1;
  status: Text2SqlExecutionReceiptV1["status"];
  readOnlyEnforced: boolean;
  authorizationRechecked: boolean;
  timeoutMs: number;
  cancelled: boolean;
  rowCount: number;
  byteCount: number;
  resultDigest?: string;
  reasonCodes?: string[];
  startedAt: string;
  completedAt: string;
}): Text2SqlExecutionReceiptV1 {
  const expected = {
    runId: input.permit.runId,
    queryContractDigest: input.permit.queryContractDigest,
    sqlDigest: input.permit.sqlDigest,
    versions: input.permit.versions
  };
  assertText2SqlExecutionPermitBinding(input.permit, expected);
  assertText2SqlAccuracyGateReceiptDigest(input.sandboxGateReceipt);
  assertReceiptBinding(input.sandboxGateReceipt, expected);
  if (input.sandboxGateReceipt.gate !== "sandbox") {
    throw new Error("execution_receipt_sandbox_gate_invalid");
  }
  if (
    input.status === "passed" &&
    (input.sandboxGateReceipt.status !== "passed" ||
      input.sandboxGateReceipt.capability !== "available")
  ) {
    throw new Error("execution_receipt_sandbox_gate_not_passed");
  }
  if (
    !Number.isFinite(Date.parse(input.startedAt)) ||
    !Number.isFinite(Date.parse(input.completedAt)) ||
    Date.parse(input.completedAt) < Date.parse(input.startedAt)
  ) {
    throw new Error("execution_receipt_time_invalid");
  }
  const unsigned = {
    version: "execution-receipt.v1" as const,
    runId: input.permit.runId,
    queryContractDigest: input.permit.queryContractDigest,
    sqlDigest: input.permit.sqlDigest,
    versions: input.permit.versions,
    executionPermitDigest: input.permit.receiptDigest,
    sandboxGateReceiptDigest: input.sandboxGateReceipt.receiptDigest,
    status: input.status,
    readOnlyEnforced: input.readOnlyEnforced,
    authorizationRechecked: input.authorizationRechecked,
    timeoutMs: input.timeoutMs,
    cancelled: input.cancelled,
    rowCount: input.rowCount,
    byteCount: input.byteCount,
    ...(input.resultDigest ? { resultDigest: input.resultDigest } : {}),
    reasonCodes: [...(input.reasonCodes ?? [])],
    startedAt: input.startedAt,
    completedAt: input.completedAt
  };
  const digest = receiptDigest(unsigned);
  return {
    ...unsigned,
    receiptId: `execution:${digest}`,
    receiptDigest: digest
  };
}
