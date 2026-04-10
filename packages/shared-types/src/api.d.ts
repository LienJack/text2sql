export type ChatRole = "user" | "assistant" | "system";
export type RunStatus = "clarification" | "executionResult" | "rejected" | "failed";
export interface Session {
    id: string;
    datasource: string;
    createdAt: string;
}
export interface ChatMessage {
    id: string;
    sessionId: string;
    role: ChatRole;
    content: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
}
export interface ClarificationPrompt {
    question: string;
    reason: string;
}
export interface ExecutionTraceStep {
    node: string;
    status: "success" | "failed" | "skipped";
    detail?: string;
    at: string;
}
export interface ExecutionTrace {
    runId: string;
    provider: string;
    retryCount: number;
    steps: ExecutionTraceStep[];
}
export interface SqlRun {
    runId: string;
    sessionId: string;
    question: string;
    status: RunStatus;
    provider: string;
    sql?: string;
    explanation?: string;
    answer?: string;
    rows?: Array<Record<string, unknown>>;
    columns?: string[];
    error?: string;
    clarification?: ClarificationPrompt;
    trace: ExecutionTrace;
    createdAt: string;
}
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
        details?: Record<string, unknown>;
    };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
