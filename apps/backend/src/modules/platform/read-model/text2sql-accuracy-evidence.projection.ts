import { createHash } from "node:crypto";
import type {
  Text2SqlAccuracyDeliverySummaryV1,
  Text2SqlAccuracyEvidenceV1,
  Text2SqlAccuracyGateKindV1,
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlV2TerminationReason
} from "@text2sql/shared-types";

const GATE_ORDER: readonly Text2SqlAccuracyGateKindV1[] = [
  "intent",
  "semantic",
  "structural",
  "policy",
  "resource",
  "sandbox",
  "result"
];

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
};

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");

const versionsEqual = (
  left: Text2SqlEvalVersionTupleV1 | undefined,
  right: Text2SqlEvalVersionTupleV1 | undefined
): boolean => Boolean(left && right && digest(left) === digest(right));

const receiptDigestValid = (receipt: {
  receiptId: string;
  receiptDigest: string;
}): boolean => {
  const {
    receiptId: _receiptId,
    receiptDigest: actualDigest,
    ...unsigned
  } = receipt;
  return digest(unsigned) === actualDigest;
};

export interface Text2SqlAccuracyEvidenceVerification {
  valid: boolean;
  reasonCodes: string[];
}

export function verifyText2SqlAccuracyEvidence(
  evidence: Text2SqlAccuracyEvidenceV1 | undefined
): Text2SqlAccuracyEvidenceVerification {
  if (!evidence) {
    return { valid: true, reasonCodes: [] };
  }
  const reasons: string[] = [];
  const queryContractDigest = evidence.queryContract?.digest;
  const runId = evidence.queryContract?.runId;
  const versions = evidence.versions;
  const receipts = [
    ...(evidence.policyReceipt ? [evidence.policyReceipt] : []),
    ...(evidence.closureReceipt ? [evidence.closureReceipt] : []),
    ...(evidence.gateReceipts ?? []),
    ...(evidence.executionPermit ? [evidence.executionPermit] : []),
    ...(evidence.executionReceipt ? [evidence.executionReceipt] : []),
    ...(evidence.resultReceipt ? [evidence.resultReceipt] : []),
    ...(evidence.repairReceipts ?? []),
    ...(evidence.validationReceipt ? [evidence.validationReceipt] : [])
  ];
  for (const receipt of receipts) {
    if (!receiptDigestValid(receipt)) {
      reasons.push(`accuracy_receipt_digest_invalid:${receipt.receiptId}`);
    }
    if (runId && receipt.runId !== runId) {
      reasons.push(`accuracy_receipt_run_mismatch:${receipt.receiptId}`);
    }
    if (queryContractDigest && receipt.queryContractDigest !== queryContractDigest) {
      reasons.push(`accuracy_receipt_contract_mismatch:${receipt.receiptId}`);
    }
    if (versions && !versionsEqual(receipt.versions, versions)) {
      reasons.push(`accuracy_receipt_version_mismatch:${receipt.receiptId}`);
    }
  }

  const gates = new Map<Text2SqlAccuracyGateKindV1, Text2SqlAccuracyGateReceiptV1>();
  for (const receipt of evidence.gateReceipts ?? []) {
    if (gates.has(receipt.gate)) {
      reasons.push(`accuracy_gate_duplicate:${receipt.gate}`);
    }
    gates.set(receipt.gate, receipt);
  }
  const permit = evidence.executionPermit;
  if (permit) {
    for (const gate of ["intent", "semantic", "structural", "policy", "resource"] as const) {
      const gateReceipt = gates.get(gate);
      if (!gateReceipt || permit.gateReceiptDigests[gate] !== gateReceipt.receiptDigest) {
        reasons.push(`accuracy_permit_gate_chain_invalid:${gate}`);
      }
    }
  }
  if (
    evidence.executionReceipt &&
    (!permit || evidence.executionReceipt.executionPermitDigest !== permit.receiptDigest)
  ) {
    reasons.push("accuracy_execution_permit_chain_invalid");
  }
  if (
    evidence.resultReceipt &&
    (!evidence.executionReceipt ||
      evidence.resultReceipt.executionReceiptDigest !==
        evidence.executionReceipt.receiptDigest)
  ) {
    reasons.push("accuracy_result_execution_chain_invalid");
  }

  let priorPatchedSqlDigest: string | undefined;
  for (const repair of evidence.repairReceipts ?? []) {
    if (repair.equivalenceStatus !== "proven") {
      reasons.push(`accuracy_repair_not_proven:${repair.receiptId}`);
    }
    if (priorPatchedSqlDigest && repair.parentSqlDigest !== priorPatchedSqlDigest) {
      reasons.push(`accuracy_repair_chain_invalid:${repair.receiptId}`);
    }
    priorPatchedSqlDigest = repair.patchedSqlDigest;
  }

  const finalReceipt = evidence.validationReceipt;
  if (finalReceipt) {
    if (evidence.executionReceipt && finalReceipt.executionReceiptDigest !== evidence.executionReceipt.receiptDigest) {
      reasons.push("accuracy_validation_execution_chain_invalid");
    }
    if (evidence.resultReceipt && finalReceipt.resultReceiptDigest !== evidence.resultReceipt.receiptDigest) {
      reasons.push("accuracy_validation_result_chain_invalid");
    }
    if (
      priorPatchedSqlDigest &&
      finalReceipt.sqlDigest !== priorPatchedSqlDigest
    ) {
      reasons.push("accuracy_validation_repair_sql_mismatch");
    }
    const expectedGateDigests = GATE_ORDER.map((gate) => gates.get(gate)?.receiptDigest);
    if (
      expectedGateDigests.some((item) => !item) ||
      JSON.stringify(expectedGateDigests) !== JSON.stringify(finalReceipt.gateReceiptDigests)
    ) {
      reasons.push("accuracy_validation_gate_chain_invalid");
    }
    const expectedRepairDigests = (evidence.repairReceipts ?? []).map(
      (receipt) => receipt.receiptDigest
    );
    if (
      JSON.stringify(expectedRepairDigests) !==
      JSON.stringify(finalReceipt.repairReceiptDigests)
    ) {
      reasons.push("accuracy_validation_repair_chain_invalid");
    }
  }

  return {
    valid: reasons.length === 0,
    reasonCodes: Array.from(new Set(reasons))
  };
}

export function buildText2SqlAccuracyDeliverySummary(input: {
  evidence?: Text2SqlAccuracyEvidenceV1;
  terminationReason?: Text2SqlV2TerminationReason;
  currentVersions?: Text2SqlEvalVersionTupleV1;
}): Text2SqlAccuracyDeliverySummaryV1 | undefined {
  if (!input.evidence) {
    return undefined;
  }
  const verification = verifyText2SqlAccuracyEvidence(input.evidence);
  const gateStatuses = Object.fromEntries(
    (input.evidence.gateReceipts ?? []).map((receipt) => [receipt.gate, receipt.status])
  ) as Text2SqlAccuracyDeliverySummaryV1["gateStatuses"];
  const failedGates = GATE_ORDER.filter((gate) => {
    const status = gateStatuses?.[gate];
    return status === "failed" || status === "unavailable";
  });
  const gateReasonCodes = (input.evidence.gateReceipts ?? [])
    .filter((receipt) => receipt.status !== "passed")
    .flatMap((receipt) => receipt.reasonCodes.map((reason) => `${receipt.gate}:${reason}`));
  const finalReceipt = input.evidence.validationReceipt;
  const lastGateReceipt = input.evidence.gateReceipts?.at(-1);
  const sqlDigest =
    finalReceipt?.sqlDigest ??
    input.evidence.resultReceipt?.sqlDigest ??
    input.evidence.executionReceipt?.sqlDigest ??
    input.evidence.executionPermit?.sqlDigest ??
    lastGateReceipt?.sqlDigest;
  const finalStatus = finalReceipt?.status ??
    (failedGates.some((gate) => gateStatuses?.[gate] === "failed")
      ? "failed"
      : failedGates.length > 0
        ? "unavailable"
        : undefined);
  const stale = Boolean(
    input.currentVersions &&
      input.evidence.versions &&
      !versionsEqual(input.currentVersions, input.evidence.versions)
  );
  const receiptRefs = [
    ...(input.evidence.policyReceipt ? [input.evidence.policyReceipt.receiptId] : []),
    ...(input.evidence.closureReceipt ? [input.evidence.closureReceipt.receiptId] : []),
    ...(input.evidence.gateReceipts ?? []).map((receipt) => receipt.receiptId),
    ...(input.evidence.repairReceipts ?? []).map((receipt) => receipt.receiptId),
    ...(input.evidence.executionPermit ? [input.evidence.executionPermit.receiptId] : []),
    ...(input.evidence.executionReceipt ? [input.evidence.executionReceipt.receiptId] : []),
    ...(input.evidence.resultReceipt ? [input.evidence.resultReceipt.receiptId] : []),
    ...(finalReceipt ? [finalReceipt.receiptId] : [])
  ];
  return {
    version: "text2sql-accuracy-summary.v1",
    mode: input.evidence.mode,
    queryContractDigest: input.evidence.queryContract?.digest,
    sqlDigest,
    finalStatus,
    gateStatuses,
    failedGates: failedGates.length > 0 ? failedGates : undefined,
    repairCount: input.evidence.repairReceipts?.length ?? 0,
    terminalReason: input.terminationReason,
    finalReceiptRef: finalReceipt?.receiptId,
    evidenceValid: verification.valid,
    stale,
    staleReasonCodes: stale ? ["accuracy_version_tuple_stale"] : undefined,
    reasonCodes: Array.from(new Set([...gateReasonCodes, ...verification.reasonCodes])),
    receiptRefs: receiptRefs.length > 0 ? receiptRefs : undefined
  };
}

export function withoutRawAccuracyEvidence<T extends { v2?: { accuracy?: unknown } }>(
  trace: T
): T {
  if (!trace.v2) {
    return trace;
  }
  const { accuracy: _accuracy, ...safeV2 } = trace.v2;
  return {
    ...trace,
    v2: safeV2
  } as T;
}
