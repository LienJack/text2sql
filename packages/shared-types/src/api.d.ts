import type { ModelingCalculatedFieldExpressionErrorDetails } from "./modeling";
export type { AnalysisArtifactMetadata, AnalysisAttemptRecord, AnalysisEvent, AnalysisGoalContract, AnalysisManifestRecord, AnalysisReceiptRecord, AnalysisTaskCommand, AnalysisTaskReadModel, AnalysisTaskRecord, AnalysisTaskRevisionRecord, AnalysisTaskStatus } from "@text2sql/analysis-task-protocol";
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
export type RagTaskType = "embedding" | "rerank";
export type RagConfigSource = "settings" | "env_fallback" | "missing";
export type RagConfigHealthStatus = "unknown" | "healthy" | "degraded" | "failed";
export type AuthenticationMode = "dev_headers" | "oidc_bearer";
export type PrincipalTrustLevel = "verified" | "development";
export type PrincipalRole = "system_admin" | "workspace_admin" | "workspace_member" | "admin" | "member";
export interface TrustedPrincipalContext {
    authenticationMethod: AuthenticationMode;
    trustLevel: PrincipalTrustLevel;
    subject: string;
    actorId: string;
    requestedWorkspaceId?: string;
    roleSet: PrincipalRole[];
    issuedAt?: string;
    expiresAt?: string;
    authPolicyVersion: string;
    digest: string;
}
export type AnalysisEvidenceCompleteness = "complete" | "partial" | "conflicted" | "insufficient" | "unavailable";
export interface AnalysisEvidenceObservationV1 {
    metric: string;
    value: string | number | null;
    dimensions: Record<string, string>;
    observedAt?: string;
    unit?: string;
    grain?: string;
}
export interface AnalysisEvidenceV1 {
    version: "analysis-evidence.v1";
    evidenceId: string;
    sourceKind: "sql" | "web";
    sourceArtifactRef: string;
    sourceRef: string;
    sourceDigest: string;
    locator?: string;
    authorization: {
        principalDigest?: string;
        policyRefs: string[];
        receiptRefs: string[];
    };
    metadata: {
        entities: string[];
        entityAliases: Record<string, string>;
        effectiveFrom?: string;
        effectiveTo?: string;
        observedAt?: string;
        timezone?: string;
        grain?: string;
        units: Record<string, string>;
        missingIntervals: string[];
    };
    observations: AnalysisEvidenceObservationV1[];
    completeness: AnalysisEvidenceCompleteness;
    qualityFlags: string[];
    lineage: {
        taskId: string;
        revisionId: string;
        attemptId?: string;
        inputDigest: string;
    };
    calculationHint?: AnalysisCalculationContractV1;
}
export type AnalysisAlignmentDimension = "entity" | "time" | "unit" | "grain" | "missing" | "conflict";
export interface AnalysisAlignmentCheckV1 {
    dimension: AnalysisAlignmentDimension;
    status: "passed" | "failed" | "unknown";
    reasonCodes: string[];
    evidenceRefs: string[];
}
export interface AnalysisEvidenceAlignmentV1 {
    version: "analysis-evidence-alignment.v1";
    evidenceRefs: string[];
    checks: AnalysisAlignmentCheckV1[];
    closed: boolean;
    requiresHumanDecision: boolean;
    unresolvedDimensions: AnalysisAlignmentDimension[];
    calculationContract?: AnalysisCalculationContractV1;
}
export type AnalysisCalculationOperator = "sum" | "difference" | "ratio" | "percent_change" | "contribution_share";
export interface AnalysisCalculationContractV1 {
    version: "analysis-calculation-contract.v1";
    operatorVersion: "deterministic-decimal.v1";
    operator: AnalysisCalculationOperator;
    inputs: Array<{
        name: string;
        value: string | number | null;
        evidenceRef: string;
    }>;
    precision: number;
    rounding: "half_up";
    nullPolicy: "reject" | "zero";
    outputUnit?: string;
}
export interface AnalysisCalculationV1 {
    version: "analysis-calculation.v1";
    contract: AnalysisCalculationContractV1;
    inputDigest: string;
    output: {
        value: string;
        unit?: string;
    };
    outputDigest: string;
    recomputable: true;
}
export interface AnalysisClaimV1 {
    version: "analysis-claim.v1";
    claimId: string;
    kind: "fact" | "inference" | "judgment";
    statement: string;
    value?: string;
    unit?: string;
    supportingEvidenceRefs: string[];
    contradictingEvidenceRefs: string[];
    calculationRefs: string[];
    alignmentRef: string;
    scope: string;
    validFrom?: string;
    validTo?: string;
    unknowns: string[];
    alternatives: string[];
    strength: "strong" | "moderate" | "weak" | "unsupported";
}
export interface AnalysisConflictSetV1 {
    version: "analysis-conflict-set.v1";
    conflictId: string;
    comparisonKey: string;
    competingValues: Array<{
        value: string;
        unit?: string;
        evidenceRefs: string[];
        conditions: string[];
    }>;
    status: "unresolved" | "resolved";
    resolutionDecisionRef?: string;
}
export interface AnalysisReportV1 {
    version: "analysis-report.v1";
    title: string;
    summary: string;
    sections: Array<{
        heading: string;
        claimRefs: string[];
        statements: string[];
    }>;
    claims: AnalysisClaimV1[];
    conflictRefs: string[];
    limitations: string[];
    chartSpecs: Array<{
        title: string;
        type: "metric" | "bar" | "line" | "table";
        claimRefs: string[];
        evidenceRefs: string[];
    }>;
    projectionDigest: string;
}
export type KnowledgeAssetKind = "memory" | "skill";
export type KnowledgeAssetStatus = "candidate" | "verified" | "shadow" | "canary" | "active" | "held" | "rolled_back" | "tombstoned";
export type KnowledgeAssetScopeType = "workspace" | "datasource" | "global" | "system";
export interface KnowledgeAssetEvaluationV1 {
    version: "knowledge-asset-evaluation.v1";
    independentEvidenceRefs: string[];
    regressionReceiptRefs: string[];
    pairedEvaluationRefs: string[];
    canaryReceiptRefs: string[];
    approvalDecisionRef?: string;
    requestedCapabilities: string[];
    invocationGrant: string[];
    riskTags: string[];
    heldFromStatus?: Exclude<KnowledgeAssetStatus, "held">;
    reasonCodes: string[];
}
export interface KnowledgeAssetV1 {
    version: "knowledge-asset.v1";
    id: string;
    workspaceId: string;
    assetKind: KnowledgeAssetKind;
    assetKey: string;
    assetVersion: number;
    status: KnowledgeAssetStatus;
    stateVersion: number;
    scope: {
        type: KnowledgeAssetScopeType;
        ref?: string;
    };
    authority: {
        level: string;
        actorId: string;
    };
    content: Record<string, unknown>;
    contentDigest: string;
    sourceRefs: string[];
    capabilityCeiling: string[];
    evaluation: KnowledgeAssetEvaluationV1;
    rollbackRef?: string;
    validFrom?: string;
    validTo?: string;
    heldAt?: string;
    tombstonedAt?: string;
    createdAt: string;
    updatedAt: string;
}
export interface AnalysisCorrectionV1 {
    version: "analysis-correction.v1";
    correctionId: string;
    targetArtifactRefs: string[];
    replacementArtifactRefs: string[];
    errorClass: "metric_definition" | "source_data" | "entity_mapping" | "time_scope" | "unit" | "calculation" | "other";
    authority: {
        actorId: string;
        principalDigest: string;
        decisionRef?: string;
    };
    scope: string;
    effectiveAt: string;
    reason: string;
}
export interface AnalysisCorrectionImpactV1 {
    version: "analysis-correction-impact.v1";
    correctionRef: string;
    targetArtifactRefs: string[];
    impactedArtifactRefs: string[];
    invalidatedArtifactRefs: string[];
    staleArtifactRefs: string[];
    impactedKnowledgeAssetRefs: string[];
    affectedKinds: string[];
    requiresNewRevision: true;
    computedAt: string;
    impactDigest: string;
}
export interface Session {
    id: string;
    datasource: string;
    origin?: "chat" | "analysis";
    analysisTaskId?: string | null;
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
export type Text2SqlV2StageName = "intake" | "retrieve" | "assemble-context" | "semantic-plan" | "generate-sql" | "validate" | "correct" | "execute" | "answer";
export interface Text2SqlV2ProviderMetadata {
    provider?: string;
    model?: string;
    dimensions?: number;
    vectorVersion?: string;
    indexVersion?: string;
    scope?: string;
    assetType?: string;
    timeoutMs?: number;
    inputCount?: number;
    outputCount?: number;
    fallbackReason?: string;
    unavailableReason?: string;
}
export interface Text2SqlV2FailureSemantic {
    code: string;
    message: string;
    category?: "intake" | "retrieval" | "planning" | "generation" | "validation" | "governance" | "execution" | "unknown";
    terminal?: boolean;
    correctable?: boolean;
}
export interface Text2SqlV2StageArtifact {
    stage: Text2SqlV2StageName;
    status: "success" | "skipped" | "degraded" | "failed" | "clarification";
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    warnings?: string[];
    evidenceIds?: string[];
    provider?: Text2SqlV2ProviderMetadata;
    failure?: Text2SqlV2FailureSemantic;
    metadata?: Record<string, unknown>;
}
export type SemanticContextPackStatusV1 = "ready" | "degraded";
export type SemanticContextPackCapabilityV1 = "structured_lanes" | "structured_degradation" | "structured_pruning" | "structured_permission_filtering" | "selected_context_summary" | "semantic_binding_refs" | (string & {});
export type SemanticContextPackLaneStateV1Status = "ready" | "degraded" | "unavailable" | "skipped" | (string & {});
export type SemanticContextPackPermissionFilteringStatusV1 = "applied" | "skipped" | (string & {});
export interface SemanticContextPackIdentifierLaneV1 {
    ids: string[];
    count: number;
    reasonCodes?: string[];
}
export interface SemanticContextPackReferenceLaneV1 {
    refs: string[];
    count: number;
    reasonCodes?: string[];
}
export interface SemanticContextPackSemanticBindingsV1 {
    modelKeys?: string[];
    relationshipKeys?: string[];
    metricKeys?: string[];
    calculatedFieldKeys?: string[];
}
export interface SemanticContextPackStructuredLanesV1 {
    tables?: SemanticContextPackIdentifierLaneV1;
    columns?: SemanticContextPackIdentifierLaneV1;
    aliases?: SemanticContextPackIdentifierLaneV1;
    relationships?: SemanticContextPackReferenceLaneV1;
    metrics?: SemanticContextPackReferenceLaneV1;
    calculatedFields?: SemanticContextPackReferenceLaneV1;
    examples?: SemanticContextPackReferenceLaneV1;
    instructions?: SemanticContextPackReferenceLaneV1;
    priorSql?: SemanticContextPackReferenceLaneV1;
    schemaSupplementRefs?: SemanticContextPackReferenceLaneV1;
    dialectFunctions?: SemanticContextPackReferenceLaneV1;
    semanticBindings?: SemanticContextPackSemanticBindingsV1;
}
export interface SemanticContextPackSelectedContextSummaryV1 {
    count: number;
    evidenceIds: string[];
    laneNames?: string[];
}
export interface SemanticContextPackLaneStateV1 {
    lane: string;
    state: SemanticContextPackLaneStateV1Status;
    refs?: string[];
    reasonCodes?: string[];
    unavailableReason?: string;
    fallbackReason?: string;
    inputCount?: number;
    outputCount?: number;
    selectedCount?: number;
}
export interface SemanticContextPackDegradationV1 {
    status: SemanticContextPackStatusV1;
    reasons: string[];
    riskTags?: string[];
    denseUnavailableReason?: string;
    rerankUnavailableReason?: string;
    laneIssues?: SemanticContextPackLaneStateV1[];
}
export interface SemanticContextPackPruningDecisionV1 {
    budgetSource?: string;
    keptEvidenceIds?: string[];
    removedEvidenceIds?: string[];
    keptCount?: number;
    removedCount?: number;
    reasonCodes?: string[];
    summary?: string;
}
export interface SemanticContextPackPruningV1 {
    applied: boolean;
    decisions: SemanticContextPackPruningDecisionV1[];
}
export interface SemanticContextPackPermissionFilteringV1 {
    status: SemanticContextPackPermissionFilteringStatusV1;
    deniedEvidenceIds?: string[];
    deniedEvidenceCount?: number;
    deniedTables?: string[];
    deniedColumns?: string[];
    reasonCodes?: string[];
}
export interface SemanticContextPackGroundingIdentityV1 {
    status: "ready" | "unavailable";
    policyVersion?: number;
    policyDigest?: string;
    schemaSnapshotId?: string;
    schemaSnapshotDigest?: string;
    allowedColumnsDigest?: string;
    reasonCodes: string[];
}
export interface SemanticContextPackDependencyClosureV1 {
    status: "ready" | "ambiguous" | "missing";
    conflictSet: Array<{
        subject: string;
        competingEvidenceRefs: string[];
    }>;
    joinClosure: string[];
    metricDependencies: string[];
    calculatedDependencies: string[];
    filterDependencies: string[];
    timeDependencies: string[];
    mandatoryEvidenceRefs: string[];
    optionalEvidenceRefs: string[];
    reasonCodes: string[];
}
export interface SemanticContextPackV1 {
    status: SemanticContextPackStatusV1;
    selectedEvidenceIds: string[];
    selectedTables: string[];
    selectedColumns: string[];
    warnings?: string[];
    version?: string;
    capabilities?: SemanticContextPackCapabilityV1[];
    semanticVersion?: number;
    modelingRevision?: number;
    semanticLockStatus?: "locked" | "fallback" | "degraded";
    selectedContextSummary?: SemanticContextPackSelectedContextSummaryV1;
    lanes?: SemanticContextPackStructuredLanesV1;
    laneStates?: SemanticContextPackLaneStateV1[];
    degradation?: SemanticContextPackDegradationV1;
    pruning?: SemanticContextPackPruningV1;
    permissionFiltering?: SemanticContextPackPermissionFilteringV1;
    groundingIdentity?: SemanticContextPackGroundingIdentityV1;
    dependencyClosure?: SemanticContextPackDependencyClosureV1;
}
export interface SemanticPlanCoverageGapV1 {
    gapType: "evidence_gap" | "user_decision_gap" | (string & {});
    subjectKind: "metric" | "dimension" | "filter" | "time" | "table" | "column" | "join_path" | "general" | (string & {});
    reasonCode: string;
    evidenceRefs: string[];
    impactScope: "semantic_plan" | "sql_generation" | "answer" | "execution" | "clarification" | (string & {});
}
export interface SemanticPlanV1 {
    route: "answer" | "clarify" | "reject";
    standaloneQuestion: string;
    selectedTables: string[];
    selectedColumns: string[];
    metrics?: string[];
    grain?: string;
    filters?: string[];
    joinPath?: string[];
    allowedTables?: string[];
    forbiddenTables?: string[];
    confidence: number;
    evidenceRefs: string[];
    coverageGaps?: SemanticPlanCoverageGapV1[];
    snapshotId?: string;
    planLedger?: SemanticPlanLedgerV1;
    queryContract?: Text2SqlQueryContractV1;
}
export type SemanticPlanLedgerObligationKindV1 = "table" | "column" | "metric" | "time_grain" | "filter" | "join_path" | "permission" | "forbidden_table" | "evidence" | (string & {});
export type SemanticPlanLedgerObligationCriticalityV1 = "hard_blocker" | "warning";
export type SemanticPlanLedgerObligationStatusV1 = "required" | "grounded" | "claimed" | "fulfilled" | "failed" | "warning" | "unsupported" | "skipped";
export interface SemanticPlanLedgerObligationV1 {
    id: string;
    kind: SemanticPlanLedgerObligationKindV1;
    summary: string;
    criticality: SemanticPlanLedgerObligationCriticalityV1;
    status: SemanticPlanLedgerObligationStatusV1;
    evidenceRefs: string[];
    reasonCodes: string[];
    subject?: string;
    expectedValue?: string;
    actualValue?: string;
}
export interface SemanticPlanLedgerSummaryV1 {
    snapshotId?: string;
    total: number;
    hardBlockerCount: number;
    warningCount: number;
    fulfilledCount?: number;
    failedCount?: number;
    unsupportedCount?: number;
    failedHardBlockerIds?: string[];
    warningIds?: string[];
    reasonCodes?: string[];
    selectedEvidenceRefs?: string[];
}
export interface SemanticPlanLedgerV1 {
    version: "plan-ledger.v1";
    snapshotId?: string;
    obligations: SemanticPlanLedgerObligationV1[];
    summary: SemanticPlanLedgerSummaryV1;
}
export interface SqlGenerationUnsupportedClaimV1 {
    kind: SemanticPlanLedgerObligationKindV1;
    value: string;
    reasonCode: string;
}
export interface SqlCorrectionGroundingV1 {
    failedSqlRef: string;
    failedSqlPreview?: string;
    retryReason: string;
    failureCode?: string;
    failureCategory?: "validation" | "governance" | "safety" | "provider" | "execution" | "unknown";
    source?: "validation" | "execution";
    attemptCount: number;
    maxAttempts: number;
    evidenceRefs: string[];
    semanticPlanSnapshotId?: string;
    semanticPlanRoute?: SemanticPlanV1["route"];
    semanticPlanRouteKind?: "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed";
    selectedTableCount?: number;
    selectedColumnCount?: number;
    contextPackStatus?: SemanticContextPackStatusV1;
    contextPackEvidenceCount?: number;
    failedObligationIds?: string[];
}
export interface SqlGenerationArtifactV1 {
    sql: string;
    assumptions?: string[];
    usedTables: string[];
    usedColumns: string[];
    evidenceRefs: string[];
    correctionGrounding?: SqlCorrectionGroundingV1;
    claimedObligationIds?: string[];
    unsupportedClaims?: SqlGenerationUnsupportedClaimV1[];
    ledgerSnapshotId?: string;
}
export interface SqlValidationCheckV1 {
    check: "parse" | "structural" | "catalog" | "read-only" | "permission" | "plan-coverage" | "relationship-path" | "dialect" | "dry-run" | "dry-plan" | "ledger-fulfillment";
    status: "passed" | "failed" | "skipped";
    code?: string;
    message?: string;
    obligationIds?: string[];
    failedObligationIds?: string[];
    reasonCodes?: string[];
}
export interface SqlValidationArtifactV1 {
    status: "passed" | "failed" | "skipped";
    checks: SqlValidationCheckV1[];
    correctable: boolean;
    failure?: Text2SqlV2FailureSemantic;
    ledgerFulfillment?: SemanticPlanLedgerSummaryV1;
    failedObligationIds?: string[];
    terminalObligationIds?: string[];
    correctableObligationIds?: string[];
    sqlAnalysis?: {
        version: "sql-analysis.v1";
        status: "ready" | "failed" | "unavailable";
        dialect?: "sqlite" | "mysql" | "postgresql";
        normalizedSqlDigest: string;
        statementCount: number;
        statementTypes: string[];
        readOnly: boolean;
        tables: string[];
        columns: string[];
        functions: string[];
        wildcards: string[];
        parameters: string[];
        astNodeCount: number;
        astDepth: number;
        reasonCodes: string[];
    };
    catalogResolution?: {
        version: "sql-catalog-resolution.v1";
        status: "resolved" | "failed" | "unavailable";
        schemaSnapshotId?: string;
        schemaSnapshotDigest?: string;
        allowedSchemaDigest?: string;
        tables: string[];
        columns: string[];
        reasonCodes: string[];
    };
    accuracy?: Text2SqlAccuracyValidationEvidenceV1;
}
export interface Text2SqlEvalVersionTupleV1 {
    questionSet: string;
    semantic: string;
    schema: string;
    policy: string;
    data: string;
    model: string;
    prompt: string;
    workflow: string;
    code: string;
}
export interface Text2SqlQueryContractTimeV1 {
    field: string;
    from?: string;
    to?: string;
    timezone: string;
    grain?: string;
}
export interface Text2SqlQueryContractResultShapeV1 {
    cardinality: "scalar" | "single_row" | "tabular" | "time_series";
    columns: Array<{
        name: string;
        semanticType: "metric" | "dimension" | "time" | "identifier" | (string & {});
        nullable?: boolean;
    }>;
}
export interface Text2SqlQueryContractV1 {
    version: "query-contract.v1";
    id: string;
    digest: string;
    runId: string;
    questionDigest: string;
    route: "text_to_sql";
    metrics: string[];
    dimensions: string[];
    requiredColumns: string[];
    filters: string[];
    time?: Text2SqlQueryContractTimeV1;
    grain: string[];
    sort: Array<{
        field: string;
        direction: "asc" | "desc";
    }>;
    limit?: number;
    resultShape: Text2SqlQueryContractResultShapeV1;
    ambiguityDecisions?: Array<{
        subject: string;
        decision: string;
        source: "user" | "approved_default";
        evidenceRefs: string[];
    }>;
    frozenAt: string;
}
export interface Text2SqlAccuracyReceiptBindingV1 {
    receiptId: string;
    receiptDigest: string;
    runId: string;
    queryContractDigest: string;
    versions: Text2SqlEvalVersionTupleV1;
}
export interface Text2SqlPolicyReceiptV1 extends Text2SqlAccuracyReceiptBindingV1 {
    version: "policy-receipt.v1";
    workspaceId: string;
    datasourceId: string;
    workspaceDatasourceBindingId: string;
    policyVersion: string;
    allowedTables: string[];
    schemaSnapshotDigest: string;
    status: "passed" | "failed" | "unavailable";
    reasonCodes: string[];
    issuedAt: string;
}
export interface Text2SqlClosureReceiptV1 extends Text2SqlAccuracyReceiptBindingV1 {
    version: "closure-receipt.v1";
    status: "passed" | "failed" | "unavailable";
    conflictSet: Array<{
        subject: string;
        competingEvidenceRefs: string[];
    }>;
    joinClosure: string[];
    metricDependencies: string[];
    calculatedDependencies: string[];
    filterDependencies: string[];
    timeDependencies: string[];
    mandatoryEvidenceRefs: string[];
    optionalEvidenceRefs: string[];
    reasonCodes: string[];
    issuedAt: string;
}
export type Text2SqlAccuracyGateKindV1 = "intent" | "semantic" | "structural" | "policy" | "resource" | "sandbox" | "result";
export type Text2SqlAccuracyGateStatusV1 = "passed" | "failed" | "unavailable";
export interface Text2SqlAccuracyGateReceiptV1 extends Text2SqlAccuracyReceiptBindingV1 {
    version: "accuracy-gate-receipt.v1";
    sqlDigest: string;
    gate: Text2SqlAccuracyGateKindV1;
    status: Text2SqlAccuracyGateStatusV1;
    capability: "available" | "unavailable";
    reasonCodes: string[];
    evidenceRefs: string[];
    parentReceiptDigests: string[];
    issuedAt: string;
}
export interface Text2SqlExecutionPermitReceiptV1 extends Text2SqlAccuracyReceiptBindingV1 {
    version: "execution-permit-receipt.v1";
    sqlDigest: string;
    status: "passed";
    gateReceiptDigests: {
        intent: string;
        semantic: string;
        structural: string;
        policy: string;
        resource: string;
    };
    issuedAt: string;
    expiresAt: string;
}
export interface Text2SqlExecutionReceiptV1 extends Text2SqlAccuracyReceiptBindingV1 {
    version: "execution-receipt.v1";
    sqlDigest: string;
    executionPermitDigest: string;
    sandboxGateReceiptDigest: string;
    status: Text2SqlAccuracyGateStatusV1;
    readOnlyEnforced: boolean;
    authorizationRechecked: boolean;
    timeoutMs: number;
    cancelled: boolean;
    rowCount: number;
    byteCount: number;
    resultDigest?: string;
    reasonCodes: string[];
    startedAt: string;
    completedAt: string;
}
export interface Text2SqlResultContractV1 {
    version: "result-contract.v1";
    digest: string;
    queryContractDigest: string;
    expectedShape: Text2SqlQueryContractResultShapeV1;
    oracleIds: string[];
    businessInvariantIds: string[];
}
export interface Text2SqlResultReceiptV1 extends Text2SqlAccuracyReceiptBindingV1 {
    version: "result-receipt.v1";
    sqlDigest: string;
    executionReceiptDigest: string;
    resultContractDigest: string;
    status: Text2SqlAccuracyGateStatusV1;
    resultDigest?: string;
    schemaMatched: boolean;
    oracleVerdicts: Array<{
        oracleId: string;
        kind: "golden_result" | "differential" | "metamorphic" | "mutation" | "business_invariant" | "llm_judge";
        mandatory: boolean;
        passed: boolean;
        evidenceRefs: string[];
    }>;
    reasonCodes: string[];
    issuedAt: string;
}
export interface Text2SqlRepairReceiptV1 extends Text2SqlAccuracyReceiptBindingV1 {
    version: "repair-receipt.v1";
    parentSqlDigest: string;
    patchedSqlDigest: string;
    patchId: string;
    patchKind: "identifier_qualification" | "identifier_quoting" | "dialect_equivalent" | (string & {});
    equivalenceStatus: "proven" | "rejected" | "unavailable";
    attempt: 1 | 2;
    changedSemanticDimensions: string[];
    reasonCodes: string[];
    issuedAt: string;
}
export interface Text2SqlValidationReceiptV1 extends Text2SqlAccuracyReceiptBindingV1 {
    version: "validation-receipt.v1";
    sqlDigest: string;
    status: Text2SqlAccuracyGateStatusV1;
    gateReceiptDigests: string[];
    executionPermitDigest?: string;
    executionReceiptDigest?: string;
    resultReceiptDigest?: string;
    repairReceiptDigests: string[];
    reasonCodes: string[];
    sealedAt: string;
}
export interface Text2SqlAccuracyValidationEvidenceV1 {
    version: "accuracy-validation-evidence.v1";
    queryContractDigest: string;
    sqlDigest: string;
    gateReceipts: Text2SqlAccuracyGateReceiptV1[];
    executionPermit?: Text2SqlExecutionPermitReceiptV1;
    finalReceipt?: Text2SqlValidationReceiptV1;
}
export interface Text2SqlAccuracyEvidenceV1 {
    version: "text2sql-accuracy-evidence.v1";
    queryContract?: Text2SqlQueryContractV1;
    versions?: Text2SqlEvalVersionTupleV1;
    policyReceipt?: Text2SqlPolicyReceiptV1;
    closureReceipt?: Text2SqlClosureReceiptV1;
    gateReceipts?: Text2SqlAccuracyGateReceiptV1[];
    executionPermit?: Text2SqlExecutionPermitReceiptV1;
    executionReceipt?: Text2SqlExecutionReceiptV1;
    resultContract?: Text2SqlResultContractV1;
    resultReceipt?: Text2SqlResultReceiptV1;
    repairReceipts?: Text2SqlRepairReceiptV1[];
    validationReceipt?: Text2SqlValidationReceiptV1;
}
export interface Text2SqlAccuracyDeliverySummaryV1 {
    version: "text2sql-accuracy-summary.v1";
    queryContractDigest?: string;
    sqlDigest?: string;
    finalStatus?: Text2SqlAccuracyGateStatusV1;
    failedGates?: Text2SqlAccuracyGateKindV1[];
    reasonCodes?: string[];
    receiptRefs?: string[];
}
export type Text2SqlV2RuntimePlanItemStatusV1 = "pending" | "running" | "completed" | "skipped" | "failed" | "clarification";
export interface Text2SqlV2RuntimePlanItemV1 {
    id: string;
    stage: Text2SqlV2StageName;
    goal: string;
    status: Text2SqlV2RuntimePlanItemStatusV1;
    reasonCodes?: string[];
    evidenceRefs?: string[];
    correctionIntent?: {
        failedStage?: Text2SqlV2StageName;
        failureCode?: string;
        retryReason: string;
        targetStage?: Text2SqlV2StageName;
    };
    startedAt?: string;
    endedAt?: string;
    summary?: string;
}
export interface Text2SqlV2RuntimePlanV1 {
    version: "runtime-plan.v1";
    items: Text2SqlV2RuntimePlanItemV1[];
    currentItemId?: string;
    summary?: string;
}
export type Text2SqlV2ArtifactRefCategoryV1 = "context_snippets" | "schema_supplement" | "prompt_input" | "provider_output_summary" | "validation_diagnostics" | "correction_grounding" | "execution_preview" | (string & {});
export interface Text2SqlV2ArtifactRefV1 {
    id: string;
    category: Text2SqlV2ArtifactRefCategoryV1;
    summary: string;
    hash: string;
    version?: string;
    sizeBytes?: number;
    replayKeyHint?: string;
    visibility: "user" | "internal" | "redacted";
    sensitivity?: "none" | "permission_filtered" | "provider_raw" | "sensitive";
    reasonCodes?: string[];
    evidenceRefs?: string[];
}
export interface Text2SqlV2SmartDefaultsEvidenceV1 {
    bundleId: string;
    version: string;
    coveredStages: Text2SqlV2StageName[];
    ruleIds: string[];
    status: "applied" | "fallback";
    fallbackReason?: string;
    templateOverlay?: {
        applied: boolean;
        templateId?: string;
        version?: number;
    };
}
export interface Text2SqlV2LoopEvidence {
    loopIndex: number;
    triggerReason: string;
    actionType: "clarify" | "fail_closed" | "continue" | "replan" | (string & {});
    planDelta?: {
        route?: {
            from?: SemanticPlanV1["route"];
            to?: SemanticPlanV1["route"];
        };
        snapshotId?: string;
        addedCoverageGapTypes?: Array<SemanticPlanCoverageGapV1["gapType"]>;
        reasonCodes?: string[];
    };
    terminationReason?: Text2SqlV2TerminationReason;
    convergencePath?: string[];
}
export type Text2SqlV2TerminationReason = "clarification_requested" | "semantic_plan_requires_clarification" | "semantic_plan_fail_closed" | (string & {});
export interface Text2SqlV2RunArtifact {
    version: "v2";
    stageOrder: Text2SqlV2StageName[];
    stages: Text2SqlV2StageArtifact[];
    contextPack?: SemanticContextPackV1;
    semanticPlan?: SemanticPlanV1;
    sqlGeneration?: SqlGenerationArtifactV1;
    sqlValidation?: SqlValidationArtifactV1;
    planLedger?: SemanticPlanLedgerSummaryV1;
    runtimePlan?: Text2SqlV2RuntimePlanV1;
    artifactRefs?: Text2SqlV2ArtifactRefV1[];
    smartDefaults?: Text2SqlV2SmartDefaultsEvidenceV1;
    accuracy?: Text2SqlAccuracyEvidenceV1;
    loopEvidence?: Text2SqlV2LoopEvidence[];
    terminationReason?: Text2SqlV2TerminationReason;
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
    loopEvidence?: Text2SqlV2LoopEvidence[];
    terminationReason?: Text2SqlV2TerminationReason;
    v2?: Text2SqlV2RunArtifact;
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
export interface DeliveryContextPackSummaryV1 {
    status: SemanticContextPackStatusV1;
    selectedEvidenceCount: number;
    selectedTableCount: number;
    selectedColumnCount: number;
    pruningApplied: boolean;
    prunedEvidenceCount?: number;
    degradedLaneCount?: number;
    permissionFilteringApplied: boolean;
    permissionDeniedEvidenceCount?: number;
    degradationReasons?: string[];
}
export interface DeliveryMetadataAnswerSummaryV1 {
    groundedByContextPack: boolean;
    routeKind?: "metadata" | "general";
    evidenceQuality: "ready" | "degraded";
    selectedEvidenceCount: number;
    permissionFilteringApplied: boolean;
    pruningApplied: boolean;
    degradationReasons?: string[];
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
    preparationPlane?: {
        manifestFingerprints: string[];
        assetFamilyCounts: Record<string, number>;
        permissionFilteredAssetCount: number;
        twoPassSchemaRecallApplied: boolean;
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
    contextPackSummary?: DeliveryContextPackSummaryV1;
    metadataAnswer?: DeliveryMetadataAnswerSummaryV1;
    correctionGrounding?: SqlCorrectionGroundingV1;
    evidenceStale?: boolean;
    v2?: {
        version?: "v2";
        stageOrder?: Text2SqlV2StageName[];
        stageArtifacts?: Text2SqlV2StageArtifact[];
        contextPack?: SemanticContextPackV1;
        semanticPlan?: SemanticPlanV1;
        sqlGeneration?: SqlGenerationArtifactV1;
        sqlValidation?: SqlValidationArtifactV1;
        planLedger?: SemanticPlanLedgerSummaryV1;
        runtimePlan?: Text2SqlV2RuntimePlanV1;
        artifactRefs?: Text2SqlV2ArtifactRefV1[];
        smartDefaults?: Text2SqlV2SmartDefaultsEvidenceV1;
        accuracy?: Text2SqlAccuracyDeliverySummaryV1;
        loopEvidence?: Text2SqlV2LoopEvidence[];
        terminationReason?: Text2SqlV2TerminationReason;
        failure?: Text2SqlV2FailureSemantic;
    };
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
    title?: string;
    stage?: ReasoningStage;
    summary?: string;
} | {
    toolName: string;
    toolCallId: string;
    output?: unknown;
    title?: string;
    stage?: ReasoningStage;
    summary?: string;
} | {
    toolName: string;
    toolCallId: string;
    message: string;
    title?: string;
    stage?: ReasoningStage;
    summary?: string;
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
    v2?: {
        stageArtifact?: Text2SqlV2StageArtifact;
            runtimePlan?: {
                currentItemId?: string;
                stage?: Text2SqlV2StageName;
                status?: Text2SqlV2RuntimePlanItemStatusV1;
                summary?: string;
                reasonCodes?: string[];
            };
            planLedger?: SemanticPlanLedgerSummaryV1;
        };
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
export interface RagTaskConfig {
    id: string;
    taskType: RagTaskType;
    provider: string;
    model: string;
    baseUrl?: string | null;
    enabled: boolean;
    hasApiKey: boolean;
    apiKeyMasked?: string | null;
    dimensions?: number | null;
    vectorVersion?: string | null;
    timeoutMs?: number | null;
    note?: string | null;
    healthStatus: RagConfigHealthStatus;
    lastCheckedAt?: string | null;
    lastHealthLatencyMs?: number | null;
    lastHealthMessage?: string | null;
    lastError?: string | null;
    configSource: RagConfigSource;
    configSourceNote?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface RagTaskSettingsView {
    actor: SettingsActor;
    items: RagTaskConfig[];
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
