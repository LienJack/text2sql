import { ClarifyNode } from "../../src/modules/conversation/agent/nodes/clarify.node";
import * as slotFillingContext from "../../src/modules/conversation/agent/nodes/slot-filling-context";

describe("ClarifyNode", () => {
  const node = new ClarifyNode();

  it("skips clarification when slots are sufficient", () => {
    const clarification = node.run("统计近30天订单总数");
    expect(clarification).toBeUndefined();
  });

  it("asks targeted clarification when metric slot is missing", () => {
    const clarification = node.run("帮我查一下华北大区订单");
    expect(clarification).toBeDefined();
    expect(clarification?.reason).toContain("指标口径");
    expect(clarification?.question).toContain("指标口径");
    expect(clarification).toMatchObject({
      decision: "clarify",
      triggerPath: "rule",
      decisionSource: "rule",
      bypassed: false,
      confidenceLevel: "medium",
      missingCriticalSlots: ["metric"]
    });
    expect(clarification?.reasonCodes).toEqual(
      expect.arrayContaining(["missing_metric_slot"])
    );
  });

  it("exposes structured continue decision for sufficient input", () => {
    const decision = node.evaluate("统计近30天订单总数");
    expect(decision).toMatchObject({
      decision: "continue",
      action: "proceed",
      source: "rule",
      decisionSource: "rule",
      bypassed: false,
      confidence: "high",
      confidenceLevel: "high",
      missingSlots: [],
      shouldClarify: false,
      reasonCodes: ["rule_slots_sufficient"]
    });
  });

  it("exposes structured clarify decision when critical slots are missing", () => {
    const decision = node.evaluate("帮我查一下华北大区订单");
    expect(decision).toMatchObject({
      decision: "clarify",
      action: "ask_clarification",
      source: "rule",
      decisionSource: "rule",
      bypassed: false
    });
    expect(decision.missingSlots).toContain("metric");
    expect(decision.reasonCodes).toContain("missing_metric_slot");
  });

  it("uses context envelope to avoid repeated clarification", () => {
    const clarification = node.run("近30天趋势怎么样", {
      metricDefinition: "订单总数",
      entityMappings: [
        {
          entity: "华北大区",
          mappedTo: "region_north"
        }
      ],
      timeRange: {
        from: "2026-03-01",
        to: "2026-03-31"
      }
    });
    expect(clarification).toBeUndefined();
  });

  it("asks for time range when trend intent has no time slot", () => {
    const clarification = node.run("订单趋势变化如何");
    expect(clarification).toBeDefined();
    expect(clarification?.reason).toContain("时间范围");
  });

  it("skips clarification for metadata intent", () => {
    const clarification = node.run("show tables");
    expect(clarification).toBeUndefined();
  });

  it("skips clarification for sql write intent input", () => {
    const clarification = node.run("DELETE orders where id = 1");
    expect(clarification).toBeUndefined();
  });

  it("records metadata intent bypass source and reason code in decision", () => {
    const decision = node.evaluate("show tables");
    expect(decision).toMatchObject({
      decision: "continue",
      source: "metadata-intent",
      decisionSource: "metadata-intent",
      bypassed: true,
      bypassReasonCode: "bypass_metadata_intent",
      reasonCodes: ["bypass_metadata_intent"]
    });
  });

  it("records sql write bypass source and reason code in decision", () => {
    const decision = node.evaluate("DELETE FROM orders where id = 1");
    expect(decision).toMatchObject({
      decision: "continue",
      source: "sql-write-intent",
      decisionSource: "sql-write-intent",
      bypassed: true,
      bypassReasonCode: "bypass_sql_write_intent",
      reasonCodes: ["bypass_sql_write_intent"]
    });
  });

  it("keeps clarification behavior for non-sql delete wording", () => {
    const clarification = node.run("删除订单 where id = 1");
    expect(clarification).toBeDefined();
    expect(clarification?.reason).toContain("指标口径");
  });

  it("asks fallback clarification for very short input", () => {
    const clarification = node.run("订单");
    expect(clarification).toBeDefined();
    expect(clarification?.reason).toContain("分析对象");
    expect(clarification?.reason).toContain("指标口径");
    expect(clarification?.reason).toContain("时间范围");
  });

  it("returns fallback prompt when slot decision throws", () => {
    const spy = jest
      .spyOn(slotFillingContext, "decideSlotFilling")
      .mockImplementation(() => {
        throw new Error("boom");
      });
    try {
      expect(node.run("统计近30天订单总数")).toMatchObject({
        reason: "槽位解析异常",
        question: "请补充分析对象、指标口径和时间范围后重试。",
        decision: "clarify",
        triggerPath: "rule",
        decisionSource: "exception-fallback",
        bypassed: false,
        confidenceLevel: "low",
        missingCriticalSlots: ["subject", "metric", "time"],
        reasonCodes: expect.arrayContaining([
          "fallback_exception",
          "missing_subject_slot",
          "missing_metric_slot",
          "missing_time_slot"
        ])
      });
    } finally {
      spy.mockRestore();
    }
  });
});
