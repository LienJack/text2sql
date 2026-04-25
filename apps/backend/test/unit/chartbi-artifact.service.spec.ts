import { ChartBiArtifactService } from "../../src/modules/conversation/delivery/chartbi/chartbi-artifact.service";
import { ChartBiGroundingGuard } from "../../src/modules/conversation/delivery/chartbi/chartbi-grounding.guard";
import { ChartBiIntentParser } from "../../src/modules/conversation/delivery/chartbi/chartbi-intent-parser";
import { ChartBiResultProfiler } from "../../src/modules/conversation/delivery/chartbi/chartbi-result-profiler";
import { ChartBiSpecCompiler } from "../../src/modules/conversation/delivery/chartbi/chartbi-spec-compiler";
import { ChartBiValidator } from "../../src/modules/conversation/delivery/chartbi/chartbi-validator";

describe("ChartBiArtifactService", () => {
  const service = new ChartBiArtifactService(
    new ChartBiResultProfiler(),
    new ChartBiIntentParser(),
    new ChartBiSpecCompiler(),
    new ChartBiValidator(),
    new ChartBiGroundingGuard()
  );

  it("uses deterministic baseline when visual intent parsing fails", () => {
    const artifact = service.build({
      sql: "SELECT created_at, revenue FROM orders",
      columns: ["created_at", "revenue"],
      rows: [
        { created_at: "2026-04-01", revenue: 1200 },
        { created_at: "2026-04-02", revenue: 980 }
      ],
      answer: "最近两天收入波动",
      visualIntentRaw: "```vis\nchart ???\n```"
    });

    expect(artifact.chart?.type).toBe("line");
    expect(artifact.display).toBe("line");
    expect(artifact.displayModes).toEqual(expect.arrayContaining(["table", "line"]));
    expect(artifact.visualIntent?.status).toBe("failed");
    expect(artifact.validation.status).toBe("valid");
    expect(artifact.validation.source).toBe("baseline");
  });

  it("uses repaired intent when baseline is unavailable", () => {
    const artifact = service.build({
      sql: "SELECT a, b FROM metrics",
      columns: ["a", "b"],
      rows: [
        { a: 1, b: 10 },
        { a: 2, b: 12 }
      ],
      visualIntentRaw: [
        "```json",
        "{",
        '  "type": "bar",',
        '  "x": "a",',
        '  "y": "b"',
        "}",
        "```"
      ].join("\n")
    });

    expect(artifact.chart?.type).toBe("bar");
    expect(artifact.validation.status).toBe("repaired");
    expect(artifact.validation.source).toBe("repaired_intent");
    expect(artifact.display).toBe("bar");
  });

  it("falls back to table with readable reason when no chart candidate survives", () => {
    const artifact = service.build({
      sql: "SELECT note FROM logs",
      columns: ["note"],
      rows: [],
      visualIntentRaw: "invalid payload"
    });

    expect(artifact.chart).toBeUndefined();
    expect(artifact.display).toBe("table");
    expect(artifact.validation.status).toBe("fallback");
    expect(artifact.fallback?.reason).toContain("table fallback");
  });

  it("keeps baseline priority over repaired intent when baseline is valid", () => {
    const artifact = service.build({
      sql: "SELECT created_at, revenue FROM orders",
      columns: ["created_at", "revenue"],
      rows: [
        { created_at: "2026-04-01", revenue: 1200 },
        { created_at: "2026-04-02", revenue: 980 }
      ],
      visualIntentRaw: [
        "```json",
        "{",
        '  "type": "pie",',
        '  "category": "created_at",',
        '  "value": "revenue"',
        "}",
        "```"
      ].join("\n")
    });

    expect(artifact.chart?.type).toBe("line");
    expect(artifact.validation.source).toBe("baseline");
  });
});
