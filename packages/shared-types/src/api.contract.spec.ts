import type {
  AgentRunResponse,
  ChatStreamEvent,
  CreatePromptTemplateRequest,
  DeletePromptTemplateResponse,
  DeliveryContract,
  GlossaryAnchor,
  GlossaryTerm,
  ListPromptTemplatesResponse,
  PromptTemplate,
  PromptTemplateTraceEvidence,
  RollbackGlossaryAnchorResponse,
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
    riskTags: []
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
type PromptTemplateCreateRequestShape = Expect<
  IsAssignable<"datasource", CreatePromptTemplateRequest["scope"]>
>;
type PromptTemplateDeleteResponseShape = Expect<
  IsAssignable<string, DeletePromptTemplateResponse["deletedAt"]>
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
void upsertGlossaryTermResponseSample;
void rollbackGlossaryAnchorResponseSample;
