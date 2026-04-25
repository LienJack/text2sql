import type {
  AgentRunResponse,
  ChatStreamEvent,
  ClarificationPrompt,
  ContextEnvelopePinningEvidence,
  ContextEnvelope,
  CreatePromptTemplateRequest,
  DeletePromptTemplateResponse,
  DeliveryContract,
  GlossaryAnchor,
  GlossaryTerm,
  ListPromptTemplatesResponse,
  PromptTemplate,
  PromptTemplateTraceEvidence,
  RollbackGlossaryAnchorResponse,
  SendMessageRequest,
  SqlRun,
  UpdatePromptTemplateRequest,
  UpsertGlossaryTermResponse
} from "./api";

type Expect<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

const promptTemplateSample: PromptTemplate = {
  id: "pt_001",
  name: "SQL runtime baseline",
  scene: "sql",
  scope: "datasource",
  scopeKey: "ds_001",
  content: "Always use explicit table aliases.",
  status: "active",
  version: 3,
  createdByUserId: "u_admin",
  updatedByUserId: "u_admin",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z"
};

const promptTemplateTraceEvidenceSample: PromptTemplateTraceEvidence = {
  templateId: promptTemplateSample.id,
  scene: promptTemplateSample.scene,
  scope: promptTemplateSample.scope,
  version: promptTemplateSample.version,
  fallbackReason: "template-disabled"
};

const listPromptTemplatesResponseSample: ListPromptTemplatesResponse = {
  items: [promptTemplateSample],
  page: 1,
  pageSize: 20,
  total: 1
};

const createPromptTemplateRequestSample: CreatePromptTemplateRequest = {
  name: "workspace sql guidance",
  scene: "sql",
  scope: "workspace",
  scopeKey: "ws_001",
  content: "Prefer grouping by business keys.",
  status: "draft"
};

const contextEnvelopeSample: ContextEnvelope = {
  metricDefinition: "净销售额=订单金额-退款金额",
  timeRange: {
    from: "2026-01-01",
    to: "2026-03-31",
    timezone: "Asia/Shanghai"
  },
  entityMappings: [
    {
      entity: "华东区",
      mappedTo: "region=east_china"
    }
  ],
  mustIncludeTables: ["orders", "refunds"],
  mustExcludeTables: ["internal_audit_logs"],
  pinnedTables: ["orders"],
  pinnedColumns: ["amount"],
  businessConstraints: ["仅统计已支付订单"]
};

const sendMessageRequestWithEnvelopeSample: SendMessageRequest = {
  message: "统计华东区本季度净销售额",
  contextEnvelope: contextEnvelopeSample
};

const sendMessageRequestLegacySample: SendMessageRequest = {
  message: "统计订单状态分布"
};

const clarificationPromptSample: ClarificationPrompt = {
  question: "请补充时间范围（例如近30天、本季度或具体起止日期）。",
  reason: "关键槽位缺失：时间范围",
  decision: "clarify",
  triggerPath: "rule",
  decisionSource: "rule",
  bypassed: false,
  confidenceLevel: "low",
  missingCriticalSlots: ["time"],
  conflictDetected: false,
  reasonCodes: ["missing_time_slot"]
};

const updatePromptTemplateRequestSample: UpdatePromptTemplateRequest = {
  name: "workspace sql guidance v2",
  status: "active"
};

const deletePromptTemplateResponseSample: DeletePromptTemplateResponse = {
  id: promptTemplateSample.id,
  deletedAt: "2026-04-18T00:00:00.000Z"
};

const deliverySample: DeliveryContract = {
  answer: {
    text: "ok",
    status: "executionResult",
    provider: "openai",
    model: "gpt-5.4"
  },
  evidence: {
    runId: "run_123",
    retrievalStatus: "ready",
    promptTemplate: promptTemplateTraceEvidenceSample,
    selectedContext: {
      count: 1,
      snippets: ["users table schema"]
    },
    retrievalLogs: [
      {
        replayKey: "retrieval:selected_context",
        stage: "retrieval",
        indexVersionId: "idx_v1",
        createdAt: "2026-04-18T00:00:00.000Z"
      }
    ],
    riskTags: [],
    effectiveContextSummary: {
      sourcePriority: "user_explicit_over_system",
      userEnvelope: {
        metricDefinitionProvided: true,
        timeRangeProvided: true,
        entityMappingCount: 1,
        includeTableCount: 1,
        excludeTableCount: 0,
        pinnedTableCount: 1,
        pinnedColumnCount: 1,
        businessConstraintCount: 1
      },
      retrievalContext: {
        status: "ready",
        selectedContextCount: 1,
        pinning: {
          enabled: true,
          status: "applied",
          candidateFilteredCount: 1,
          selectedContextFilteredCount: 0
        }
      }
    },
    conflictHint: {
      hasConflict: false,
      preferredSource: "user_explicit"
    },
    clarificationDecision: {
      decision: "clarify",
      triggerPath: "rule",
      decisionSource: "rule",
      bypassed: false,
      confidenceLevel: "low",
      missingCriticalSlots: ["time"],
      conflictDetected: false,
      reasonCodes: ["missing_time_slot"],
      question: clarificationPromptSample.question,
      reason: clarificationPromptSample.reason
    }
  },
  artifact: {
    sql: "select 1",
    columns: ["value"],
    rowCount: 1,
    rowsPreview: [{ value: 1 }],
    hasError: false
  }
};

const sqlRunSample: SqlRun = {
  runId: "run_123",
  sessionId: "session_123",
  question: "hello",
  status: "executionResult",
  provider: "openai",
  sql: "select 1",
  answer: "ok",
  rows: [{ value: 1 }],
  columns: ["value"],
  trace: {
    runId: "run_123",
    provider: "openai",
    retryCount: 0,
    steps: [],
    promptTemplate: promptTemplateTraceEvidenceSample
  },
  delivery: deliverySample,
  createdAt: "2026-04-18T00:00:00.000Z"
};

const agentRunResponseSample: AgentRunResponse = {
  kind: "agent-run",
  outcome: "executionResult",
  run: sqlRunSample,
  delivery: deliverySample,
  agent: {
    provider: "openai",
    model: "gpt-5.4",
    hasSql: true,
    hasToolCalls: false,
    hasError: false
  }
};

const finishEventWithDelivery: ChatStreamEvent = {
  type: "finish",
  runId: "run_123",
  sessionId: "session_123",
  at: "2026-04-18T00:00:00.000Z",
  data: {
    status: "executionResult",
    rowCount: 1,
    delivery: deliverySample
  }
};

const finishEventWithoutDelivery: ChatStreamEvent = {
  type: "finish",
  runId: "run_123",
  sessionId: "session_123",
  at: "2026-04-18T00:00:00.000Z",
  data: {
    status: "failed",
    rowCount: 0
  }
};

const glossaryAnchorSample: GlossaryAnchor = {
  id: "anchor_001",
  scope: "datasource",
  scopeKey: "ds_001",
  datasourceId: "ds_001",
  version: 2,
  anchorType: "rollback",
  status: "rolled_back",
  summary: "rollback to stable snapshot",
  rollbackFromAnchorId: "anchor_000",
  rollbackReason: "degraded retrieval",
  createdByRunId: "run_123",
  metadata: {
    source: "unit-test"
  },
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z"
};

const glossaryTermSample: GlossaryTerm = {
  id: "term_001",
  term: "customer",
  normalizedTerm: "customer",
  definition: "customer dimension term",
  synonyms: ["client", "buyer"],
  scope: "datasource",
  scopeKey: "ds_001",
  datasourceId: "ds_001",
  priority: 80,
  conflictResolution: "priority_then_updated_at",
  status: "active",
  version: 2,
  versionAnchorId: glossaryAnchorSample.id,
  rollbackAnchorId: "anchor_000",
  metadata: {
    actor: "admin"
  },
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z"
};

const upsertGlossaryTermResponseSample: UpsertGlossaryTermResponse = {
  term: glossaryTermSample,
  linkageStatus: "success",
  conflictDecision: {
    resolution: "priority_then_updated_at",
    winnerTermId: glossaryTermSample.id,
    loserTermIds: ["term_002"],
    winnerPriority: glossaryTermSample.priority,
    winnerUpdatedAt: glossaryTermSample.updatedAt
  },
  activeAnchor: glossaryAnchorSample
};

const rollbackGlossaryAnchorResponseSample: RollbackGlossaryAnchorResponse = {
  activeAnchor: glossaryAnchorSample,
  previousAnchorId: "anchor_003",
  replayed: false,
  idempotencyKey: "rollback-anchor-req-001"
};

type DeliveryOnRunIsCompatible = Expect<IsAssignable<DeliveryContract | undefined, SqlRun["delivery"]>>;
type DeliveryOnAgentResponseIsCompatible = Expect<
  IsAssignable<DeliveryContract | undefined, AgentRunResponse["delivery"]>
>;
type PromptTemplateScopeSupportsWorkspace = Expect<IsAssignable<"workspace", PromptTemplate["scope"]>>;
type PromptTemplateSceneSupportsSql = Expect<IsAssignable<"sql", PromptTemplate["scene"]>>;
type PromptTemplateTraceFallbackShape = Expect<
  IsAssignable<string | undefined, PromptTemplateTraceEvidence["fallbackReason"]>
>;
type TraceEffectiveContextPriorityShape = Expect<
  IsAssignable<
    "user_explicit_over_system",
    NonNullable<SqlRun["trace"]["effectiveContextSummary"]>["sourcePriority"]
  >
>;
type TraceConflictHintPreferredSourceShape = Expect<
  IsAssignable<
    "user_explicit",
    NonNullable<SqlRun["trace"]["conflictHint"]>["preferredSource"]
  >
>;
type DeliveryEffectiveContextPriorityShape = Expect<
  IsAssignable<
    "user_explicit_over_system",
    NonNullable<
      NonNullable<DeliveryContract["evidence"]>["effectiveContextSummary"]
    >["sourcePriority"]
  >
>;
type DeliveryConflictHintPreferredSourceShape = Expect<
  IsAssignable<
    "user_explicit",
    NonNullable<NonNullable<DeliveryContract["evidence"]>["conflictHint"]>["preferredSource"]
  >
>;
type ClarificationPromptDecisionShape = Expect<
  IsAssignable<"clarify" | undefined, ClarificationPrompt["decision"]>
>;
type ClarificationPromptSlotShape = Expect<
  IsAssignable<string[] | undefined, ClarificationPrompt["missingCriticalSlots"]>
>;
type ClarificationPromptBypassShape = Expect<
  IsAssignable<boolean | undefined, ClarificationPrompt["bypassed"]>
>;
type ClarificationPromptDecisionSourceShape = Expect<
  IsAssignable<string | undefined, ClarificationPrompt["decisionSource"]>
>;
type ClarificationPromptBypassReasonCodeShape = Expect<
  IsAssignable<string | undefined, ClarificationPrompt["bypassReasonCode"]>
>;
type TraceClarificationDecisionPathShape = Expect<
  IsAssignable<
    "rule" | "semantic" | "hybrid" | undefined,
    NonNullable<SqlRun["trace"]["clarificationDecision"]>["triggerPath"]
  >
>;
type DeliveryClarificationDecisionConfidenceShape = Expect<
  IsAssignable<
    "high" | "medium" | "low" | undefined,
    NonNullable<
      NonNullable<DeliveryContract["evidence"]>["clarificationDecision"]
    >["confidenceLevel"]
  >
>;
type DeliveryClarificationDecisionSourceShape = Expect<
  IsAssignable<
    string | undefined,
    NonNullable<
      NonNullable<DeliveryContract["evidence"]>["clarificationDecision"]
    >["decisionSource"]
  >
>;
type DeliveryClarificationDecisionBypassShape = Expect<
  IsAssignable<
    boolean | undefined,
    NonNullable<
      NonNullable<DeliveryContract["evidence"]>["clarificationDecision"]
    >["bypassed"]
  >
>;
type PromptTemplateCreateRequestShape = Expect<
  IsAssignable<"datasource", CreatePromptTemplateRequest["scope"]>
>;
type PromptTemplateDeleteResponseShape = Expect<
  IsAssignable<string, DeletePromptTemplateResponse["deletedAt"]>
>;
type ContextEnvelopeMetricDefinitionShape = Expect<
  IsAssignable<string | undefined, ContextEnvelope["metricDefinition"]>
>;
type ContextEnvelopeTimeRangeTimezoneShape = Expect<
  IsAssignable<
    string | undefined,
    NonNullable<ContextEnvelope["timeRange"]>["timezone"]
  >
>;
type ContextEnvelopeEntityMappingShape = Expect<
  IsAssignable<
    string,
    NonNullable<ContextEnvelope["entityMappings"]>[number]["entity"]
  >
>;
type ContextEnvelopePinnedTablesShape = Expect<
  IsAssignable<string[] | undefined, ContextEnvelope["pinnedTables"]>
>;
type ContextEnvelopePinnedColumnsShape = Expect<
  IsAssignable<string[] | undefined, ContextEnvelope["pinnedColumns"]>
>;
type TracePinningEvidenceShape = Expect<
  IsAssignable<
    ContextEnvelopePinningEvidence | undefined,
    NonNullable<
      NonNullable<SqlRun["trace"]["effectiveContextSummary"]>["retrievalContext"]
    >["pinning"]
  >
>;
type SendMessageRequestContextOptional = Expect<
  IsAssignable<ContextEnvelope | undefined, SendMessageRequest["contextEnvelope"]>
>;
type SendMessageRequestMessageShape = Expect<
  IsAssignable<string, SendMessageRequest["message"]>
>;
type GlossaryScopeSupportsDatasource = Expect<IsAssignable<"datasource", GlossaryTerm["scope"]>>;
type GlossaryPriorityIsNumeric = Expect<IsAssignable<number, GlossaryTerm["priority"]>>;
type GlossaryConflictResolutionStable = Expect<
  IsAssignable<"priority_then_updated_at", GlossaryTerm["conflictResolution"]>
>;
type GlossaryRollbackReferenceShape = Expect<
  IsAssignable<string | null | undefined, GlossaryAnchor["rollbackFromAnchorId"]>
>;
type GlossaryUpsertAnchorSemantics = Expect<
  IsAssignable<GlossaryAnchor | null | undefined, UpsertGlossaryTermResponse["activeAnchor"]>
>;

void agentRunResponseSample;
void finishEventWithDelivery;
void finishEventWithoutDelivery;
void listPromptTemplatesResponseSample;
void createPromptTemplateRequestSample;
void updatePromptTemplateRequestSample;
void deletePromptTemplateResponseSample;
void clarificationPromptSample;
void contextEnvelopeSample;
void sendMessageRequestWithEnvelopeSample;
void sendMessageRequestLegacySample;
void upsertGlossaryTermResponseSample;
void rollbackGlossaryAnchorResponseSample;
