import {
  buildFallbackSlotFillingDecision,
  decideSlotFilling
} from "../../src/modules/conversation/agent/nodes/slot-filling-context";

describe("slot-filling-context", () => {
  it("returns structured continue decision for complete question", () => {
    const decision = decideSlotFilling("统计近30天订单总数");

    expect(decision).toMatchObject({
      decision: "continue",
      action: "proceed",
      source: "rule",
      decisionSource: "rule",
      triggerPath: "rule",
      bypassed: false,
      confidence: "high",
      confidenceLevel: "high",
      missingSlots: [],
      shouldClarify: false,
      missingCriticalSlots: [],
      reasonCodes: ["rule_slots_sufficient"]
    });
  });

  it("bypasses clarification for metadata intent", () => {
    const decision = decideSlotFilling("show tables");

    expect(decision).toMatchObject({
      decision: "continue",
      action: "proceed",
      source: "metadata-intent",
      decisionSource: "metadata-intent",
      bypassed: true,
      bypassReasonCode: "bypass_metadata_intent",
      confidence: "high",
      shouldClarify: false,
      missingSlots: [],
      reasonCodes: ["bypass_metadata_intent"]
    });
  });

  it("bypasses clarification for sql write intent with reason code", () => {
    const decision = decideSlotFilling("DELETE FROM orders where id = 1");

    expect(decision).toMatchObject({
      decision: "continue",
      action: "proceed",
      source: "sql-write-intent",
      decisionSource: "sql-write-intent",
      bypassed: true,
      bypassReasonCode: "bypass_sql_write_intent",
      reasonCodes: ["bypass_sql_write_intent"]
    });
  });

  it("falls back to shortest clarification for very short input", () => {
    const decision = decideSlotFilling("订单");

    expect(decision).toMatchObject({
      decision: "clarify",
      action: "ask_clarification",
      source: "short-input-fallback",
      decisionSource: "short-input-fallback",
      bypassed: false,
      confidence: "low",
      confidenceLevel: "low",
      shouldClarify: true,
      missingSlots: ["subject", "metric", "time"],
      reasonCodes: [
        "fallback_short_input",
        "missing_subject_slot",
        "missing_metric_slot",
        "missing_time_slot"
      ]
    });
    expect(decision.reason).toContain("分析对象");
    expect(decision.reason).toContain("指标口径");
    expect(decision.reason).toContain("时间范围");
  });

  it("asks for time when trend intent lacks time slot", () => {
    const decision = decideSlotFilling("订单数量趋势怎么样");

    expect(decision.shouldClarify).toBe(true);
    expect(decision.missingSlots).toContain("time");
    expect(decision.source).toBe("rule");
    expect(decision.reasonCodes).toContain("missing_time_slot");
  });

  it("uses context envelope to fill critical slots", () => {
    const decision = decideSlotFilling("近30天趋势怎么样", {
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

    expect(decision).toMatchObject({
      decision: "continue",
      action: "proceed",
      source: "rule",
      shouldClarify: false,
      missingSlots: [],
      reasonCodes: ["rule_slots_sufficient"]
    });
  });

  it("returns exception fallback decision shape", () => {
    const decision = buildFallbackSlotFillingDecision();

    expect(decision).toMatchObject({
      decision: "clarify",
      action: "ask_clarification",
      source: "exception-fallback",
      confidence: "low",
      shouldClarify: true,
      missingSlots: ["subject", "metric", "time"],
      reasonCodes: [
        "fallback_exception",
        "missing_subject_slot",
        "missing_metric_slot",
        "missing_time_slot"
      ]
    });
  });
});
