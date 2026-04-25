import type { ModelingCalculatedFieldExpressionErrorDetails } from "./modeling";
export type ChatRole = "user" | "assistant" | "system";
export type RunStatus = "clarification" | "executionResult" | "rejected" | "failed";
export type SessionSyncStatus = "healthy" | "pending" | "degraded";
export type StreamStatus = "in_progress" | "completed" | "failed";
export type DatasourceType = "sqlite" | "mysql" | "postgresql" | "excel" | "csv";
export type DatasourceStatus = "available" | "unavailable" | "deleted";
export type PromptTemplateScene = "sql" | "analysis";
export type PromptTemplateScope = "global" | "workspace" | "datasource";
export type PromptTemplateStatus = "draft" | "active" | "archived";
export type ReasoningStage = "analysis" | "generation" | "validation" | "execution" | "response" | "unknown";
export type LlmProviderCode = "openai" | "gemini" | "deepseek" | "kimi" | "volcengine" | "siliconflow" | "openrouter" | "minimax" | "tencent-hunyuan" | "tongyi";
export type ProviderSyncStatus = "idle" | "syncing" | "healthy" | "degraded" | "failed";
export type ModelHealthStatus = "unknown" | "healthy" | "degraded" | "failed";
export interface Session {
    id: string;
    datasource: string;
    workspaceId?: string | null;
    createdByUserId?: string | null;
    datasourceName?: string;
    datasourceType?: DatasourceType;
    datasourceStatus?: DatasourceStatus;
    createdAt: string;
    title?: string;
    modelCatalogId?: string | null;
    modelProvider?: string | null;
    modelName?: string | null;
    debugEnabled?: boolean;
    lastMessageAt?: string;
    syncStatus?: SessionSyncStatus;
    deletedAt?: string | null;
    syncFailedCount?: number;
    lastSyncFailureAt?: string | null;
}
export interface Datasource {
    id: string;
    name: string;
    type: DatasourceType;
    status: DatasourceStatus;
    readonly: boolean;
    shared: boolean;
    config?: Record<string, unknown> | null;
    fileMeta?: Record<string, unknown> | null;
    unavailableAt?: string | null;
    deletedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface ChatMessage {
    id: string;
    sessionId: string;
    role: ChatRole;
    content: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
}
export type ClarificationDecision = "continue" | "clarify";
export type ClarificationTriggerPath = "rule" | "semantic" | "hybrid";
export type ClarificationConfidenceLevel = "high" | "medium" | "low";
export type ClarificationDecisionSource = "rule" | "metadata-intent" | "sql-write-intent" | "short-input-fallback" | "exception-fallback" | (string & {});
export type ClarificationSlotKey = "subject" | "metric" | "time" | "dimension" | "filter" | (string & {});
export interface ClarificationDecisionEvidence {
    decision?: ClarificationDecision;
    triggerPath?: ClarificationTriggerPath;
    decisionSource?: ClarificationDecisionSource;
    bypassed?: boolean;
    bypassReasonCode?: string;
    confidenceLevel?: ClarificationConfidenceLevel;
    missingCriticalSlots?: ClarificationSlotKey[];
    conflictDetected?: boolean;
    reasonCodes?: string[];
    question?: string;
    reason?: string;
}
export interface ClarificationPrompt extends ClarificationDecisionEvidence {
    question: string;
    reason: string;
}
export interface ContextEnvelopeTimeRange {
    from?: string;
    to?: string;
    timezone?: string;
}
export interface ContextEnvelopeEntityMapping {
    entity: string;
    mappedTo: string;
}
export interface ContextEnvelope {
    metricDefinition?: string;
    timeRange?: ContextEnvelopeTimeRange;
    entityMappings?: ContextEnvelopeEntityMapping[];
    mustIncludeTables?: string[];
    mustExcludeTables?: string[];
    pinnedTables?: string[];
    pinnedColumns?: string[];
    businessConstraints?: string[];
}
export interface ContextEnvelopePinningEvidence {
    enabled: boolean;
    status: "applied" | "inactive";
    candidateFilteredCount?: number;
    selectedContextFilteredCount?: number;
}
export interface SendMessageRequest {
    message: string;
    contextEnvelope?: ContextEnvelope;
}
export interface PromptTemplateTraceEvidence {
    templateId?: string;
    scene?: PromptTemplateScene;
    scope?: PromptTemplateScope;
    version?: number;
    fallbackReason?: string;
}
export interface PromptTemplateTraceEvidenceCompat extends PromptTemplateTraceEvidence {
    template_id?: string;
    scene_name?: string;
    template_scene?: string;
    scope_type?: PromptTemplateScope;
    template_scope?: PromptTemplateScope;
    template_version?: number;
    fallback_reason?: string;
}
export interface ExecutionTraceStep {
    node: string;
    status: "success" | "failed" | "skipped";
    stepId?: string;
    sequence?: number;
    lifecycle?: "running" | "completed" | "failed" | "skipped";
    detail?: string;
    at: string;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    inputSummary?: string;
    outputSummary?: string;
    errorSummary?: string;
}
export interface ExecutionTrace {
    runId: string;
    provider: string;
    retryCount: number;
    steps: ExecutionTraceStep[];
    streamStatus?: StreamStatus;
    toolCalls?: Array<{
        toolName: string;
        toolCallId: string;
        status: "called" | "result" | "error";
        detail?: string;
        at: string;
    }>;
    promptTemplate?: PromptTemplateTraceEvidence;
    modelingRevision?: number;
    effectiveContextSummary?: {
        sourcePriority: "user_explicit_over_system";
        userEnvelope: {
            metricDefinitionProvided: boolean;
            timeRangeProvided: boolean;
            entityMappingCount: number;
            includeTableCount: number;
            excludeTableCount: number;
            pinnedTableCount?: number;
            pinnedColumnCount?: number;
            businessConstraintCount: number;
        };
        retrievalContext?: {
            status?: "ready" | "degraded";
            selectedContextCount?: number;
            pinning?: ContextEnvelopePinningEvidence;
        };
    };
    conflictHint?: {
        hasConflict: boolean;
        preferredSource: "user_explicit";
        reasonCodes?: string[];
    };
    clarificationDecision?: ClarificationDecisionEvidence;
}
export interface LlmRawOutput {
    provider: string;
    model: string;
    rawText: string;
    createdAt: string;
}
export interface DeliveryAnswerLayer {
    text: string;
    status: RunStatus;
    provider: string;
    model?: string;
}
export interface DeliveryEvidenceReplayLog {
    replayKey: string;
    stage: string;
    indexVersionId?: string;
    createdAt: string;
}
export interface DeliverySavedPriorSqlEvidence {
    status: "hit" | "miss" | "filtered" | "stale" | "ambiguous";
    shortcutUsed: boolean;
    reasonCodes?: string[];
    selectedChunkId?: string;
    selectedViewId?: string;
    selectedViewName?: string;
    selectedSourceRunId?: string;
    safetyResult?: "passed" | "rejected" | "fallback_generated";
}
export interface DeliveryEvidenceLayer {
    runId: string;
    retrievalStatus?: "ready" | "degraded";
    degradeReasons?: string[];
    promptTemplate?: PromptTemplateTraceEvidence;
    selectedContext?: {
        count: number;
        snippets?: string[];
    };
    retrievalLogs?: DeliveryEvidenceReplayLog[];
    riskTags?: string[];
    semanticVersion?: number;
    modelingRevision?: number;
    semanticSpineVersion?: number;
    semanticLockStatus?: "locked" | "fallback" | "degraded";
    contextPackStatus?: "ready" | "degraded";
    semanticInstructionSummary?: {
        modelBindingCount: number;
        relationshipBindingCount: number;
        metricBindingCount: number;
        calculatedFieldBindingCount: number;
    };
    semanticDegradeReason?: string;
    skillContextSummary?: {
        skillCount: number;
        contextCount: number;
        degradeReason?: string;
    };
    effectiveContextSummary?: {
        sourcePriority: "user_explicit_over_system";
        userEnvelope: {
            metricDefinitionProvided: boolean;
            timeRangeProvided: boolean;
            entityMappingCount: number;
            includeTableCount: number;
            excludeTableCount: number;
            pinnedTableCount?: number;
            pinnedColumnCount?: number;
            businessConstraintCount: number;
        };
        retrievalContext?: {
            status?: "ready" | "degraded";
            selectedContextCount?: number;
            pinning?: ContextEnvelopePinningEvidence;
        };
    };
    conflictHint?: {
        hasConflict: boolean;
        preferredSource: "user_explicit";
        reasonCodes?: string[];
    };
    clarificationDecision?: ClarificationDecisionEvidence;
    savedPriorSql?: DeliverySavedPriorSqlEvidence;
    evidenceStale?: boolean;
}
export type DeliveryArtifactChartType = "table" | "metric" | "bar" | "line" | "pie";
export type DeliveryArtifactDisplayType = "summary" | "chart" | "table" | "sql" | DeliveryArtifactChartType;
export type DeliveryArtifactValidationStatus = "valid" | "repaired" | "fallback" | "invalid";
export type DeliveryArtifactVisualIntentSource = "deterministic" | "model" | "hybrid";
export interface DeliveryArtifactSummaryMetric {
    key: string;
    label: string;
    value: string | number;
    unit?: string;
    trend?: "up" | "down" | "flat";
}
export interface DeliveryArtifactSummary {
    text: string;
    headline?: string;
    metrics?: DeliveryArtifactSummaryMetric[];
    dimensions?: string[];
}
export interface DeliveryArtifactTable {
    columns?: string[];
    rowCount: number;
    rowsPreview?: Array<Record<string, unknown>>;
    previewRowCount?: number;
}
export interface DeliveryArtifactChartMappings {
    dimension?: string;
    time?: string;
    x?: string;
    y?: string;
    measure?: string;
    value?: string;
    label?: string;
    series?: string;
}
export interface DeliveryArtifactChartSeries {
    key: string;
    label?: string;
    aggregation?: "sum" | "avg" | "min" | "max" | "count" | (string & {});
}
export interface DeliveryArtifactChartMeta {
    title?: string;
    subtitle?: string;
    unit?: string;
    xLabel?: string;
    yLabel?: string;
}
export interface DeliveryArtifactChart {
    type: DeliveryArtifactChartType;
    mappings?: DeliveryArtifactChartMappings;
    series?: DeliveryArtifactChartSeries[];
    meta?: DeliveryArtifactChartMeta;
}
export interface DeliveryArtifactValidation {
    status: DeliveryArtifactValidationStatus;
    reasonCodes?: string[];
    message?: string;
}
export interface DeliveryArtifactFallback {
    display: "table";
    reason: string;
    reasonCode?: string;
    fromType?: string;
}
export interface DeliveryArtifactVisualIntent {
    source: DeliveryArtifactVisualIntentSource;
    type?: DeliveryArtifactChartType;
    title?: string;
    summaryHint?: string;
    insight?: string;
    mappings?: Partial<DeliveryArtifactChartMappings>;
    rawSyntax?: string;
    normalizedIntent?: Record<string, unknown>;
}
export interface DeliveryArtifactLayer {
    summary?: DeliveryArtifactSummary;
    table?: DeliveryArtifactTable;
    chart?: DeliveryArtifactChart;
    display?: DeliveryArtifactDisplayType;
    validation?: DeliveryArtifactValidation;
    fallback?: DeliveryArtifactFallback;
    visualIntent?: DeliveryArtifactVisualIntent;
    sql?: string;
    columns?: string[];
    rowCount: number;
    rowsPreview?: Array<Record<string, unknown>>;
    hasError: boolean;
}
export interface DeliveryContract {
    answer: DeliveryAnswerLayer;
    evidence?: DeliveryEvidenceLayer;
    artifact?: DeliveryArtifactLayer;
}
export interface RagQualityGateReport {
    thresholds: {
        recallAt20Min: number;
        mrrAt10Min: number;
        retrievalRerankP95MsMax: number;
        degradeRateMax: number;
        minSamples: number;
    };
    sampleSize: number;
    sampleReady: boolean;
    latest?: {
        runId: string;
        datasourceId: string;
        recordedAt: string;
        metrics: {
            recallAt20: number;
            mrrAt10: number;
            retrievalRerankP95Ms: number;
            degradeRate: number;
        };
    };
    gatePass: boolean;
    reasons: string[];
    generatedAt: string;
}
export interface RagReplayCompletenessReport {
    runId: string;
    requiredStages: string[];
    observedStages: string[];
    missingStages: string[];
    completeness: number;
    ready: boolean;
}
export type RagMemoryStatus = "candidate" | "verified" | "production";
export interface RagMemoryFeedbackRequest {
    runId: string;
    targetStatus: RagMemoryStatus;
    note?: string;
}
export interface RagMemoryFeedbackResponse {
    runId: string;
    candidateId: string;
    beforeStatus: RagMemoryStatus;
    afterStatus: RagMemoryStatus;
    applied: boolean;
    note?: string;
    updatedAt: string;
}
export interface SqlRun {
    runId: string;
    sessionId: string;
    question: string;
    status: RunStatus;
    provider: string;
    model?: string;
    sql?: string;
    explanation?: string;
    answer?: string;
    rows?: Array<Record<string, unknown>>;
    columns?: string[];
    error?: string;
    clarification?: ClarificationPrompt;
    trace: ExecutionTrace;
    llmRaw?: LlmRawOutput | null;
    delivery?: DeliveryContract;
    createdAt: string;
}
export interface ChatSessionView {
    session: Session;
    messages: ChatMessage[];
    latestRun?: SqlRun;
}
export interface AgentRunResponse {
    kind: "agent-run";
    outcome: RunStatus;
    run: SqlRun;
    delivery?: DeliveryContract;
    agent: {
        provider: string;
        model?: string;
        hasSql: boolean;
        hasToolCalls: boolean;
        hasError: boolean;
    };
}
export type ChatStreamEventType = "start" | "text-delta" | "tool-call" | "tool-result" | "tool-error" | "state" | "finish" | "error";
export type ChatStreamEventData = {
    requestId: string | null;
} | {
    text: string;
} | {
    toolName: string;
    toolCallId: string;
    input?: unknown;
} | {
    toolName: string;
    toolCallId: string;
    output?: unknown;
} | {
    toolName: string;
    toolCallId: string;
    message: string;
} | {
    node: string;
    status: "success" | "failed" | "skipped";
    stepId?: string;
    sequence?: number;
    lifecycle?: "running" | "completed" | "failed" | "skipped";
    detail: string;
    stage?: ReasoningStage;
    title?: string;
    at?: string;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    inputSummary?: string;
    outputSummary?: string;
    errorSummary?: string;
} | {
    status: RunStatus;
    rowCount: number;
    delivery?: DeliveryContract;
} | {
    code?: string;
    message: string;
    details?: Record<string, unknown> | null;
};
export interface ChatStreamEvent {
    type: ChatStreamEventType;
    runId: string;
    sessionId: string;
    at: string;
    data: ChatStreamEventData;
}
export interface ProviderConfig {
    id: string;
    provider: LlmProviderCode;
    displayName: string;
    baseUrl?: string | null;
    enabled: boolean;
    hasApiKey: boolean;
    apiKeyMasked?: string | null;
    lastSyncAt?: string | null;
    lastSyncStatus: ProviderSyncStatus;
    lastSyncError?: string | null;
    modelCount: number;
    createdAt: string;
    updatedAt: string;
}
export interface ModelCatalogItem {
    id: string;
    providerConfigId: string;
    provider: LlmProviderCode;
    model: string;
    displayName: string;
    capabilities?: string[];
    contextWindow?: number | null;
    enabled: boolean;
    healthStatus: ModelHealthStatus;
    lastHealthCheckAt?: string | null;
    lastSyncedAt?: string | null;
    metadata?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
export interface SettingsActor {
    id: string;
    role: "admin" | "user";
}
export interface LlmSettingsView {
    actor: SettingsActor;
    providers: ProviderConfig[];
    models: ModelCatalogItem[];
    defaultModelId?: string | null;
}
export type PlatformUserStatus = "active" | "disabled" | "deleted";
export type WorkspaceStatus = "active" | "archived" | "deleted";
export type WorkspaceMemberRole = "admin" | "member";
export type DatasourceWorkflowMode = "create" | "edit";
export type DatasourceWorkflowStage = "received" | "workspace_create_started" | "workspace_ready" | "datasource_create_started" | "datasource_update_started" | "datasource_ready" | "binding_apply_started" | "validation_failed" | "workspace_create_failed" | "datasource_create_failed" | "datasource_update_failed" | "binding_applied" | "binding_apply_failed" | "completed" | "compensation_soft_delete_failed" | "compensation_mark_unavailable_failed" | "unknown";
export interface DatasourceUpsertPayload {
    datasourceId?: string;
    name?: string;
    type?: DatasourceType;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    filePath?: string;
    shared?: boolean;
}
export interface DatasourceWorkflowWorkspaceInput {
    workspaceId?: string;
    create?: {
        name: string;
    };
}
export interface DatasourceCreateWorkflowRequest {
    mode: "create";
    datasource: DatasourceUpsertPayload;
    workspaceId?: string;
    workspaceCreate?: {
        name: string;
    };
}
export interface DatasourceEditWorkflowRequest {
    mode: "edit";
    datasourceId: string;
    datasource?: DatasourceUpsertPayload;
    workspaceId?: string;
    workspaceCreate?: {
        name: string;
    };
}
export type UpsertDatasourceWorkflowRequest = DatasourceCreateWorkflowRequest | DatasourceEditWorkflowRequest;
export interface PreviewDatasourceTablesCreateRequest {
    mode: "create";
    datasource: DatasourceUpsertPayload;
}
export interface PreviewDatasourceTablesEditRequest {
    mode: "edit";
    datasourceId: string;
    datasource?: DatasourceUpsertPayload;
}
export type PreviewDatasourceTablesRequest = PreviewDatasourceTablesCreateRequest | PreviewDatasourceTablesEditRequest;
export interface PreviewDatasourceTablesResponse {
    mode: "create" | "edit";
    datasourceId?: string;
    items: string[];
}
export interface DatasourceWorkflowBindingSummary {
    bound: boolean;
    workspaceId?: string;
    datasourceId?: string;
}
export interface DatasourceWorkflowFailure {
    stage: DatasourceWorkflowStage | string;
    code: string;
    details?: Record<string, unknown> | null;
}
export interface UpsertDatasourceWorkflowResponse {
    mode: DatasourceWorkflowMode;
    stage: DatasourceWorkflowStage | string;
    workspaceId: string;
    datasourceId: string;
    bindingSummary?: DatasourceWorkflowBindingSummary | null;
    idempotencyKey?: string;
    replayed?: boolean;
    failure?: DatasourceWorkflowFailure | null;
}
export interface PlatformUser {
    id: string;
    account: string;
    name: string;
    email: string;
    status: PlatformUserStatus;
    isSystemAdmin: boolean;
    defaultWorkspaceId?: string | null;
    systemVariables?: Record<string, unknown> | null;
    deletedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface Workspace {
    id: string;
    name: string;
    status: WorkspaceStatus;
    isDefault: boolean;
    deletedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface WorkspaceMember {
    id: string;
    userId: string;
    workspaceId: string;
    role: WorkspaceMemberRole;
    createdAt: string;
    updatedAt: string;
}
export interface WorkspaceDatasourceBinding {
    id: string;
    workspaceId: string;
    datasourceId: string;
    createdByUserId?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface WorkspaceDatasourceBindingListItem extends WorkspaceDatasourceBinding {
    datasourceName?: string;
    datasourceType?: DatasourceType;
    datasourceStatus?: DatasourceStatus;
}
export interface WorkspaceDatasourceTablePermissionState {
    workspaceId: string;
    datasourceId: string;
    policyVersion: number;
    tableNames: string[];
}
export interface WorkspaceDatasourceTablePermissionImpactSummary {
    beforeCount: number;
    afterCount: number;
    addedCount: number;
    removedCount: number;
    retainedCount: number;
    addedTables: string[];
    removedTables: string[];
}
export interface ListWorkspaceDatasourceTablePermissionsResponse extends WorkspaceDatasourceTablePermissionState {
}
export interface ReplaceWorkspaceDatasourceTablePermissionsRequest {
    policyVersion: number;
    tableNames: string[];
}
export interface ReplaceWorkspaceDatasourceTablePermissionsResponse extends WorkspaceDatasourceTablePermissionState {
    impactSummary: WorkspaceDatasourceTablePermissionImpactSummary;
    idempotencyKey: string;
    replayed: boolean;
}
export interface WorkspaceDatasourceBindingBatchChangeResult {
    successItems: string[];
    failedItems: Array<{
        item: string;
        code: string;
        message: string;
    }>;
}
export interface ListWorkspaceDatasourceBindingsRequest extends PaginationRequest {
    workspaceId: string;
    datasourceId?: string;
}
export type ListWorkspaceDatasourceBindingsResponse = PaginatedResponse<WorkspaceDatasourceBindingListItem>;
export interface PromptTemplateScopeRef {
    scope: PromptTemplateScope;
    scopeKey: string;
}
export interface PromptTemplate extends PromptTemplateScopeRef {
    id: string;
    name: string;
    scene: PromptTemplateScene;
    content: string;
    status: PromptTemplateStatus;
    version: number;
    createdByUserId?: string | null;
    updatedByUserId?: string | null;
    deletedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface ListPromptTemplatesRequest extends PaginationRequest {
    scene?: PromptTemplateScene;
    scope?: PromptTemplateScope;
    scopeKey?: string;
    status?: PromptTemplateStatus;
    query?: string;
    includeDeleted?: boolean;
}
export type ListPromptTemplatesResponse = PaginatedResponse<PromptTemplate>;
export interface CreatePromptTemplateRequest extends PromptTemplateScopeRef {
    name: string;
    scene: PromptTemplateScene;
    content: string;
    status?: PromptTemplateStatus;
}
export interface UpdatePromptTemplateRequest {
    name?: string;
    content?: string;
    status?: PromptTemplateStatus;
}
export type CreatePromptTemplateResponse = PromptTemplate;
export type UpdatePromptTemplateResponse = PromptTemplate;
export interface DeletePromptTemplateResponse {
    id: string;
    deletedAt: string;
}
export type GlossaryScope = "global" | "datasource";
export type GlossaryTermStatus = "active" | "inactive";
export type GlossaryConflictResolution = "priority_then_updated_at";
export type GlossaryAnchorType = "release" | "rollback";
export type GlossaryAnchorStatus = "active" | "superseded" | "rolled_back";
export type GlossaryLinkageStatus = "success" | "empty" | "error" | "degraded";
export interface GlossaryScopeRef {
    scope: GlossaryScope;
    scopeKey: string;
    datasourceId?: string | null;
}
export interface GlossaryConflictDecision {
    resolution: GlossaryConflictResolution;
    winnerTermId: string;
    loserTermIds: string[];
    winnerPriority: number;
    winnerUpdatedAt: string;
}
export interface GlossaryTerm extends GlossaryScopeRef {
    id: string;
    term: string;
    normalizedTerm: string;
    definition: string;
    synonyms: string[];
    priority: number;
    conflictResolution: GlossaryConflictResolution;
    status: GlossaryTermStatus;
    version: number;
    versionAnchorId?: string | null;
    rollbackAnchorId?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
}
export interface GlossaryAnchor extends GlossaryScopeRef {
    id: string;
    version: number;
    anchorType: GlossaryAnchorType;
    status: GlossaryAnchorStatus;
    summary?: string | null;
    rollbackFromAnchorId?: string | null;
    rollbackReason?: string | null;
    createdByRunId?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
}
export interface ListGlossaryTermsRequest extends PaginationRequest {
    scope?: GlossaryScope;
    datasourceId?: string;
    status?: GlossaryTermStatus;
    query?: string;
    version?: number;
}
export type ListGlossaryTermsResponse = PaginatedResponse<GlossaryTerm>;
export interface CreateGlossaryTermRequest {
    term: string;
    definition: string;
    synonyms?: string[];
    scope: GlossaryScope;
    datasourceId?: string;
    priority?: number;
    conflictResolution?: GlossaryConflictResolution;
    metadata?: Record<string, unknown>;
}
export interface UpdateGlossaryTermRequest {
    definition?: string;
    synonyms?: string[];
    priority?: number;
    status?: GlossaryTermStatus;
    conflictResolution?: GlossaryConflictResolution;
    metadata?: Record<string, unknown>;
}
export interface UpsertGlossaryTermResponse {
    term: GlossaryTerm;
    linkageStatus: GlossaryLinkageStatus;
    conflictDecision?: GlossaryConflictDecision | null;
    activeAnchor?: GlossaryAnchor | null;
}
export interface ListGlossaryAnchorsRequest extends PaginationRequest {
    scope?: GlossaryScope;
    datasourceId?: string;
    anchorType?: GlossaryAnchorType;
}
export type ListGlossaryAnchorsResponse = PaginatedResponse<GlossaryAnchor>;
export interface CreateGlossaryAnchorRequest {
    scope: GlossaryScope;
    datasourceId?: string;
    version: number;
    summary?: string;
    metadata?: Record<string, unknown>;
}
export interface RollbackGlossaryAnchorRequest {
    scope: GlossaryScope;
    datasourceId?: string;
    targetAnchorId: string;
    rollbackReason?: string;
}
export interface RollbackGlossaryAnchorResponse {
    activeAnchor: GlossaryAnchor;
    previousAnchorId?: string | null;
    replayed: boolean;
    idempotencyKey: string;
}
export interface PaginationRequest {
    page?: number;
    pageSize?: number;
}
export interface PaginatedResponse<T> {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
}
export interface ListPlatformUsersRequest extends PaginationRequest {
    keyword?: string;
    statuses?: PlatformUserStatus[];
    workspaceId?: string;
    includeDeleted?: boolean;
}
export type ListPlatformUsersResponse = PaginatedResponse<PlatformUser>;
export interface ListWorkspacesRequest extends PaginationRequest {
    keyword?: string;
    statuses?: WorkspaceStatus[];
    includeDeleted?: boolean;
}
export type ListWorkspacesResponse = PaginatedResponse<Workspace>;
export interface ListWorkspaceMembersRequest extends PaginationRequest {
    workspaceId: string;
    keyword?: string;
    roles?: WorkspaceMemberRole[];
}
export type ListWorkspaceMembersResponse = PaginatedResponse<WorkspaceMember>;
export interface EvaluationCase {
    id: string;
    question: string;
    mustIncludeSql?: string[];
    expectedStatus?: RunStatus;
}
export interface EvaluationCaseResult {
    id: string;
    passed: boolean;
    reason?: string;
    run: SqlRun;
}
export interface EvaluationReport {
    jobId: string;
    provider: string;
    total: number;
    passed: number;
    passRate: number;
    createdAt: string;
    cases: EvaluationCaseResult[];
}
export interface ApiSuccess<T> {
    status: "success";
    requestId: string;
    data: T;
}
export interface ApiFailure {
    status: "error";
    requestId: string;
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown> | ModelingCalculatedFieldExpressionErrorDetails;
    };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
export type * from "./modeling";
export type * from "./semantic-spine";
