import { DeterministicCalculationService } from "../../src/modules/conversation/analysis/evidence/deterministic-calculation.service";

describe("DeterministicCalculationService", () => {
  const service = new DeterministicCalculationService();

  it("recomputes percent change with stable half-up decimal output", () => {
    const contract = {
      version: "analysis-calculation-contract.v1" as const,
      operatorVersion: "deterministic-decimal.v1" as const,
      operator: "percent_change" as const,
      inputs: [
        { name: "current", value: "80", evidenceRef: "evidence-current" },
        { name: "baseline", value: "100", evidenceRef: "evidence-baseline" }
      ],
      precision: 2,
      rounding: "half_up" as const,
      nullPolicy: "reject" as const,
      outputUnit: "%"
    };
    const first = service.execute(contract);
    const repeated = service.execute(contract);

    expect(first.output).toEqual({ value: "-20.00", unit: "%" });
    expect(first.outputDigest).toBe(repeated.outputDigest);
  });

  it("rounds ratios deterministically without eval or floating drift", () => {
    const result = service.execute({
      version: "analysis-calculation-contract.v1",
      operatorVersion: "deterministic-decimal.v1",
      operator: "ratio",
      inputs: [
        { name: "part", value: "1", evidenceRef: "a" },
        { name: "whole", value: "3", evidenceRef: "b" }
      ],
      precision: 4,
      rounding: "half_up",
      nullPolicy: "reject"
    });

    expect(result.output.value).toBe("0.3333");
  });

  it("rejects division by zero", () => {
    expect(() =>
      service.execute({
        version: "analysis-calculation-contract.v1",
        operatorVersion: "deterministic-decimal.v1",
        operator: "ratio",
        inputs: [
          { name: "part", value: "1", evidenceRef: "a" },
          { name: "whole", value: "0", evidenceRef: "b" }
        ],
        precision: 2,
        rounding: "half_up",
        nullPolicy: "reject"
      })
    ).toThrow("denominator 不能为 0");
  });
});
