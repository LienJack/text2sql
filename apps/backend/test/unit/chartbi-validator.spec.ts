import type { ChartBiCanonicalSpec } from "../../src/modules/conversation/delivery/chartbi/chartbi-result-profiler";
import { ChartBiValidator } from "../../src/modules/conversation/delivery/chartbi/chartbi-validator";

describe("ChartBiValidator", () => {
  const validator = new ChartBiValidator();

  const rows = [
    { created_at: "2026-04-01", revenue: 1200, region: "East" },
    { created_at: "2026-04-02", revenue: 980, region: "West" }
  ];
  const columns = ["created_at", "revenue", "region"];

  it("passes for valid line chart spec", () => {
    const spec: ChartBiCanonicalSpec = {
      type: "line",
      source: "baseline",
      mappings: {
        x: "created_at",
        y: "revenue"
      }
    };

    const result = validator.validate({
      spec,
      rows,
      columns
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("fails closed for chart type outside allowlist", () => {
    const result = validator.validate({
      spec: {
        type: "scatter" as never,
        source: "repaired_intent",
        mappings: {
          x: "created_at",
          y: "revenue"
        }
      },
      rows,
      columns
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("allowlist");
  });

  it("fails when mapped field is not in result columns", () => {
    const result = validator.validate({
      spec: {
        type: "bar",
        source: "repaired_intent",
        mappings: {
          x: "unknown_dimension",
          y: "revenue"
        }
      },
      rows,
      columns
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unknown_dimension");
  });

  it("fails pie chart when values contain negative numbers", () => {
    const result = validator.validate({
      spec: {
        type: "pie",
        source: "repaired_intent",
        mappings: {
          category: "region",
          value: "revenue"
        }
      },
      rows: [
        { region: "East", revenue: 100 },
        { region: "West", revenue: -5 }
      ],
      columns: ["region", "revenue"]
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("negative");
  });
});
