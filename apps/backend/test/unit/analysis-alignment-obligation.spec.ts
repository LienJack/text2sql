import type { AnalysisEvidenceV1 } from "@text2sql/shared-types";
import { AlignmentObligationService } from "../../src/modules/conversation/analysis/evidence/alignment-obligation.service";
import { ConflictSetService } from "../../src/modules/conversation/analysis/evidence/conflict-set.service";

describe("AlignmentObligationService", () => {
  const service = new AlignmentObligationService();

  it("closes entity/time/unit/grain/missing/conflict checks for aligned evidence", () => {
    const result = service.evaluate({ evidence: [evidence("a", "80"), evidence("b", "80")] });

    expect(result.closed).toBe(true);
    expect(result.requiresHumanDecision).toBe(false);
    expect(result.checks.every((check) => check.status === "passed")).toBe(true);
    expect(result.calculationContract?.inputs[0]?.evidenceRef).toBe("a");
  });

  it("keeps competing values as unresolved conflict instead of averaging", () => {
    const items = [evidence("a", "80"), evidence("b", "85")];
    const conflicts = new ConflictSetService().detect(items);
    const result = service.evaluate({ evidence: items, conflicts });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.competingValues.map((item) => item.value)).toEqual([
      "80",
      "85"
    ]);
    expect(result.closed).toBe(false);
    expect(
      result.checks.find((check) => check.dimension === "conflict")?.status
    ).toBe("failed");
  });
});

function evidence(id: string, value: string): AnalysisEvidenceV1 {
  return {
    version: "analysis-evidence.v1",
    evidenceId: id,
    sourceKind: id === "a" ? "sql" : "web",
    sourceArtifactRef: `source-${id}`,
    sourceRef: `source-${id}`,
    sourceDigest: `digest-${id}`,
    authorization: { policyRefs: [], receiptRefs: [] },
    metadata: {
      entities: ["company:acme"],
      entityAliases: {},
      effectiveFrom: "2026-04-01T00:00:00.000Z",
      effectiveTo: "2026-06-30T23:59:59.000Z",
      timezone: "UTC",
      grain: "quarter",
      units: { revenue: "USD" },
      missingIntervals: []
    },
    observations: [
      {
        metric: "revenue",
        value,
        dimensions: { company: "acme" },
        observedAt: "2026-06-30T00:00:00.000Z",
        unit: "USD",
        grain: "quarter"
      }
    ],
    completeness: "complete",
    qualityFlags: [],
    lineage: {
      taskId: "task-1",
      revisionId: "revision-1",
      inputDigest: `digest-${id}`
    },
    calculationHint: {
      version: "analysis-calculation-contract.v1",
      operatorVersion: "deterministic-decimal.v1",
      operator: "sum",
      inputs: [{ name: "revenue", value, evidenceRef: "self" }],
      precision: 2,
      rounding: "half_up",
      nullPolicy: "reject",
      outputUnit: "USD"
    }
  };
}
