import type { AnalysisEvidenceAlignmentV1 } from "@text2sql/shared-types";
import { ClaimCommitService } from "../../src/modules/conversation/analysis/evidence/claim-commit.service";
import { DeterministicCalculationService } from "../../src/modules/conversation/analysis/evidence/deterministic-calculation.service";

describe("ClaimCommitService", () => {
  const service = new ClaimCommitService();
  const calculation = new DeterministicCalculationService().execute({
    version: "analysis-calculation-contract.v1",
    operatorVersion: "deterministic-decimal.v1",
    operator: "difference",
    inputs: [
      { name: "current", value: "80", evidenceRef: "evidence-a" },
      { name: "baseline", value: "100", evidenceRef: "evidence-b" }
    ],
    precision: 2,
    rounding: "half_up",
    nullPolicy: "reject",
    outputUnit: "USD"
  });

  it("builds a strong fact only from closed alignment and calculation", () => {
    const claim = service.build({
      kind: "fact",
      statement: "收入差额为 -20.00 USD。",
      calculation,
      calculationRef: "calculation-1",
      alignment: alignment(true),
      alignmentRef: "alignment-1",
      scope: "Q2"
    });

    expect(claim.strength).toBe("strong");
    expect(claim.supportingEvidenceRefs).toEqual(["evidence-a", "evidence-b"]);
    expect(claim.calculationRefs).toEqual(["calculation-1"]);
  });

  it("rejects unsupported claims", () => {
    expect(() =>
      service.build({
        kind: "fact",
        statement: "收入差额为 -20.00 USD。",
        calculation,
        calculationRef: "calculation-1",
        alignment: alignment(false),
        alignmentRef: "alignment-1",
        scope: "Q2"
      })
    ).toThrow("Claim 需要 closed alignment");
  });
});

function alignment(closed: boolean): AnalysisEvidenceAlignmentV1 {
  return {
    version: "analysis-evidence-alignment.v1" as const,
    evidenceRefs: ["evidence-a", "evidence-b"],
    checks: [],
    closed,
    requiresHumanDecision: !closed,
    unresolvedDimensions: closed ? [] : ["unit"]
  };
}
