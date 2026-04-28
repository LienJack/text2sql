import type {
  ClarificationConfidenceLevel,
  ClarificationTriggerPath,
  ContextEnvelope
} from "@text2sql/shared-types";

export type SlotKey = "subject" | "metric" | "time" | "dimension" | "filter";
type SlotFillingDecisionState = "continue" | "clarify";
type SlotFillingAction = "proceed" | "ask_clarification";
type SlotFillingSource =
  | "rule"
  | "metadata-intent"
  | "sql-write-intent"
  | "short-input-fallback"
  | "exception-fallback";
type SlotFillingConfidence = ClarificationConfidenceLevel;

interface SlotStatus {
  key: SlotKey;
  provided: boolean;
  source?: "question" | "envelope";
}

export interface SlotFillingDecision {
  decision: SlotFillingDecisionState;
  action: SlotFillingAction;
  source: SlotFillingSource;
  decisionSource: SlotFillingSource;
  triggerPath: ClarificationTriggerPath;
  bypassed: boolean;
  bypassReasonCode?: string;
  confidence: SlotFillingConfidence;
  confidenceLevel: SlotFillingConfidence;
  missingSlots: SlotKey[];
  shouldClarify: boolean;
  missingCriticalSlots: SlotKey[];
  reasonCodes: string[];
  reason: string;
  question: string;
}

interface SlotFillingDecisionInput {
  decision: SlotFillingDecisionState;
  source: SlotFillingSource;
  confidence: SlotFillingConfidence;
  missingSlots: SlotKey[];
  reasonCodes?: string[];
  reason: string;
  question?: string;
}

function buildDecision(input: SlotFillingDecisionInput): SlotFillingDecision {
  const shouldClarify = input.decision === "clarify";
  const reasonCodes = uniqueReasonCodes(
    input.reasonCodes ?? resolveReasonCodes(input.source, input.missingSlots)
  );
  const bypassed =
    input.source === "metadata-intent" || input.source === "sql-write-intent";
  return {
    decision: input.decision,
    action: shouldClarify ? "ask_clarification" : "proceed",
    source: input.source,
    decisionSource: input.source,
    triggerPath: "rule",
    bypassed,
    bypassReasonCode: bypassed ? reasonCodes[0] : undefined,
    confidence: input.confidence,
    confidenceLevel: input.confidence,
    missingSlots: input.missingSlots,
    shouldClarify,
    missingCriticalSlots: input.missingSlots,
    reasonCodes,
    reason: input.reason,
    question: input.question ?? ""
  };
}

const MISSING_SLOT_REASON_CODE: Record<SlotKey, string> = {
  subject: "missing_subject_slot",
  metric: "missing_metric_slot",
  time: "missing_time_slot",
  dimension: "missing_dimension_slot",
  filter: "missing_filter_slot"
};

function resolveReasonCodes(source: SlotFillingSource, missingSlots: SlotKey[]): string[] {
  const missingReasonCodes = missingSlots.map((slot) => MISSING_SLOT_REASON_CODE[slot]);
  if (source === "metadata-intent") {
    return ["bypass_metadata_intent"];
  }
  if (source === "sql-write-intent") {
    return ["bypass_sql_write_intent"];
  }
  if (source === "short-input-fallback") {
    return ["fallback_short_input", ...missingReasonCodes];
  }
  if (source === "exception-fallback") {
    return ["fallback_exception", ...missingReasonCodes];
  }
  if (missingReasonCodes.length === 0) {
    return ["rule_slots_sufficient"];
  }
  return missingReasonCodes;
}

function uniqueReasonCodes(reasonCodes: string[]): string[] {
  return Array.from(
    new Set(reasonCodes.filter((reasonCode) => reasonCode.trim().length > 0))
  );
}

export function buildFallbackSlotFillingDecision(): SlotFillingDecision {
  const missingSlots: SlotKey[] = ["subject", "metric", "time"];
  return buildDecision({
    decision: "clarify",
    source: "exception-fallback",
    confidence: "low",
    missingSlots,
    reason: "槽位解析异常",
    question: "请补充分析对象、指标口径和时间范围后重试。"
  });
}

function resolveConfidence(missingSlots: SlotKey[]): SlotFillingConfidence {
  if (missingSlots.length === 0) {
    return "high";
  }
  if (missingSlots.length === 1) {
    return "medium";
  }
  return "low";
}

const METRIC_HINT_REGEX =
  /(总数|数量|计数|count|金额|交易额|销售额|gmv|平均|均值|占比|比例|转化率|留存|退款率|分布|top|排行|环比|同比)/i;
const COUNT_METRIC_HINT_REGEX = /(有多少|多少|几(个|笔|单|条|次|家|人|位))/i;
const SUBJECT_HINT_REGEX =
  /(订单|用户|客户|顾客|消费者|商品|sku|门店|支付|退款|交易|会话|工单|发票|供应商|渠道|地区|市场|销售|商家|账单)/i;
const TIME_HINT_REGEX =
  /(今天|昨日|昨天|本周|上周|本月|上月|本季度|上季度|本年|去年|近\d+\s*(天|周|月|年)|最近|过去|between|from|to|日期|时间)/i;
const DIMENSION_HINT_REGEX =
  /(按|分组|group by|各|每个|top|排行|分布|分类|维度)/i;
const FILTER_HINT_REGEX =
  /(where|并且|且|条件|过滤|仅|排除|大于|小于|等于|>=|<=|!=|=|状态|地区|渠道|品类)/i;
const METADATA_INTENT_REGEX =
  /(有哪些表|哪些表|表结构|schema|字段|列名|describe|show\s+tables|sqlite_master|元数据|数据库结构)/i;
const SQL_WRITE_INTENT_REGEX =
  /^\s*(insert|update|delete|drop|alter|truncate|create|replace|merge|grant|revoke)\b/i;

function hasNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasTimeRangeEnvelope(timeRange: ContextEnvelope["timeRange"] | undefined): boolean {
  if (!timeRange || typeof timeRange !== "object") {
    return false;
  }
  return (
    hasNonEmpty(timeRange.from) || hasNonEmpty(timeRange.to) || hasNonEmpty(timeRange.timezone)
  );
}

function hasStringArray(values: string[] | undefined): boolean {
  return Array.isArray(values) && values.some((value) => hasNonEmpty(value));
}

function hasEntityMappings(
  entityMappings: ContextEnvelope["entityMappings"] | undefined
): boolean {
  if (!Array.isArray(entityMappings)) {
    return false;
  }
  return entityMappings.some(
    (item) => hasNonEmpty(item?.entity) || hasNonEmpty(item?.mappedTo)
  );
}

function resolveSlots(question: string, contextEnvelope?: ContextEnvelope): SlotStatus[] {
  const trimmedQuestion = question.trim();
  const metricFromEnvelope = hasNonEmpty(contextEnvelope?.metricDefinition);
  const timeFromEnvelope = hasTimeRangeEnvelope(contextEnvelope?.timeRange);
  const dimensionFromEnvelope = hasEntityMappings(contextEnvelope?.entityMappings);
  const filterFromEnvelope =
    hasStringArray(contextEnvelope?.businessConstraints) ||
    hasStringArray(contextEnvelope?.mustIncludeTables) ||
    hasStringArray(contextEnvelope?.mustExcludeTables);
  const subjectFromEnvelope = dimensionFromEnvelope;

  const subjectFromQuestion = SUBJECT_HINT_REGEX.test(trimmedQuestion);
  const metricFromQuestion =
    METRIC_HINT_REGEX.test(trimmedQuestion) || COUNT_METRIC_HINT_REGEX.test(trimmedQuestion);
  const timeFromQuestion = TIME_HINT_REGEX.test(trimmedQuestion);
  const dimensionFromQuestion = DIMENSION_HINT_REGEX.test(trimmedQuestion);
  const filterFromQuestion = FILTER_HINT_REGEX.test(trimmedQuestion);

  return [
    {
      key: "subject",
      provided: subjectFromEnvelope || subjectFromQuestion,
      source: subjectFromEnvelope ? "envelope" : subjectFromQuestion ? "question" : undefined
    },
    {
      key: "metric",
      provided: metricFromEnvelope || metricFromQuestion,
      source: metricFromEnvelope ? "envelope" : metricFromQuestion ? "question" : undefined
    },
    {
      key: "time",
      provided: timeFromEnvelope || timeFromQuestion,
      source: timeFromEnvelope ? "envelope" : timeFromQuestion ? "question" : undefined
    },
    {
      key: "dimension",
      provided: dimensionFromEnvelope || dimensionFromQuestion,
      source: dimensionFromEnvelope
        ? "envelope"
        : dimensionFromQuestion
          ? "question"
          : undefined
    },
    {
      key: "filter",
      provided: filterFromEnvelope || filterFromQuestion,
      source: filterFromEnvelope ? "envelope" : filterFromQuestion ? "question" : undefined
    }
  ];
}

function resolveClarificationQuestion(missingCriticalSlots: SlotKey[]): string {
  const missingSet = new Set(missingCriticalSlots);
  if (missingSet.has("subject") && missingSet.has("metric")) {
    return "请补充分析对象和指标口径，例如“近30天订单总数”或“按支付方式统计退款金额”。";
  }
  if (missingSet.has("subject")) {
    return "请补充分析对象（例如订单、用户、商品或门店）。";
  }
  if (missingSet.has("metric")) {
    return "请补充要统计的指标口径（例如订单数、退款金额、转化率）。";
  }
  if (missingSet.has("time")) {
    return "请补充时间范围（例如近30天、本季度或具体起止日期）。";
  }
  return "请补充关键分析信息（对象、指标或时间范围）后我再继续生成 SQL。";
}

function resolveReason(missingCriticalSlots: SlotKey[]): string {
  if (missingCriticalSlots.length === 0) {
    return "问题信息充足";
  }
  const labels: Record<SlotKey, string> = {
    subject: "分析对象",
    metric: "指标口径",
    time: "时间范围",
    dimension: "维度",
    filter: "过滤条件"
  };
  return `关键槽位缺失：${missingCriticalSlots.map((item) => labels[item]).join("、")}`;
}

export function decideSlotFilling(
  question: string,
  contextEnvelope?: ContextEnvelope
): SlotFillingDecision {
  const trimmedQuestion = question.trim();
  if (SQL_WRITE_INTENT_REGEX.test(trimmedQuestion)) {
    return buildDecision({
      decision: "continue",
      source: "sql-write-intent",
      confidence: "high",
      missingSlots: [],
      reason: "检测到写操作 SQL 意图，跳过槽位澄清",
      question: ""
    });
  }
  if (METADATA_INTENT_REGEX.test(trimmedQuestion)) {
    return buildDecision({
      decision: "continue",
      source: "metadata-intent",
      confidence: "high",
      missingSlots: [],
      reason: "元数据查询意图，无需业务槽位补全",
      question: ""
    });
  }
  if (trimmedQuestion.length < 6) {
    const missingSlots: SlotKey[] = ["subject", "metric", "time"];
    return buildDecision({
      decision: "clarify",
      source: "short-input-fallback",
      confidence: "low",
      missingSlots,
      reason: resolveReason(missingSlots),
      question: resolveClarificationQuestion(missingSlots)
    });
  }

  const slots = resolveSlots(trimmedQuestion, contextEnvelope);
  const missingSet = new Set<SlotKey>();
  for (const slot of slots) {
    if (slot.provided) {
      continue;
    }
    if (slot.key === "subject" || slot.key === "metric") {
      missingSet.add(slot.key);
    }
  }

  const asksTrend = /(趋势|变化|对比|同比|环比|走势)/i.test(trimmedQuestion);
  if (asksTrend && !slots.find((slot) => slot.key === "time")?.provided) {
    missingSet.add("time");
  }

  const missingSlots = Array.from(missingSet);
  return buildDecision({
    decision: missingSlots.length > 0 ? "clarify" : "continue",
    source: "rule",
    confidence: resolveConfidence(missingSlots),
    missingSlots,
    reason: resolveReason(missingSlots),
    question: resolveClarificationQuestion(missingSlots)
  });
}
