import { ChartBiIntentParser } from "../../src/modules/conversation/delivery/chartbi/chartbi-intent-parser";

describe("ChartBiIntentParser", () => {
  const parser = new ChartBiIntentParser();

  it("parses json visual intent from fenced block with wrapper text", () => {
    const raw = [
      "下面是建议图表：",
      "```json",
      "{",
      '  "type": "line",',
      '  "x": "created_at",',
      '  "y": "revenue",',
      '  "title": "Revenue trend"',
      "}",
      "```",
      "请按需使用"
    ].join("\n");

    const parsed = parser.parse(raw);

    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      throw new Error("expected parser to return parsed status");
    }

    expect(parsed.source).toBe("json");
    expect(parsed.intent.type).toBe("line");
    expect(parsed.intent.mappings.x).toBe("created_at");
    expect(parsed.intent.mappings.y).toBe("revenue");
    expect(parsed.intent.title).toBe("Revenue trend");
  });

  it("parses vis-like syntax and normalizes aliases", () => {
    const raw = [
      "我们可以用这个：",
      "```vis",
      "chart: bar",
      "dimension: region",
      "measure: sales_amount",
      "insight: 华东区域贡献最高",
      "```"
    ].join("\n");

    const parsed = parser.parse(raw);

    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") {
      throw new Error("expected parser to return parsed status");
    }

    expect(parsed.source).toBe("vis");
    expect(parsed.intent.type).toBe("bar");
    expect(parsed.intent.mappings.dimension).toBe("region");
    expect(parsed.intent.mappings.measure).toBe("sales_amount");
    expect(parsed.intent.insights).toEqual(["华东区域贡献最高"]);
  });

  it("returns readable failure reason for unsupported payload", () => {
    const parsed = parser.parse("this output has no valid chart intent payload");

    expect(parsed.status).toBe("failed");
    if (parsed.status !== "failed") {
      throw new Error("expected parser to return failed status");
    }

    expect(parsed.reason).toContain("visual intent");
  });
});
