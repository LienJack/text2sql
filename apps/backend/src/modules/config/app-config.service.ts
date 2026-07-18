import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type AuthenticationMode = "dev_headers" | "oidc_bearer";
export type AnalysisDurableProvider = "temporal" | "in_memory";

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>("NODE_ENV", "development");
  }

  get port(): number {
    return Number(this.config.get<string>("PORT", "3002"));
  }

  get corsAllowedOrigins(): string[] {
    const raw = this.config.get<string>(
      "CORS_ALLOWED_ORIGINS",
      "http://localhost:3000"
    );
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  get authMode(): AuthenticationMode {
    const fallback = this.nodeEnv === "production" ? "oidc_bearer" : "dev_headers";
    const configured = this.config
      .get<string>("AUTH_MODE", fallback)
      .trim()
      .toLowerCase();
    if (configured === "dev_headers" || configured === "oidc_bearer") {
      return configured;
    }
    throw new Error(
      `AUTH_MODE 配置无效（${configured}），仅支持 dev_headers 或 oidc_bearer。`
    );
  }

  get authOidcIssuer(): string {
    return this.config.get<string>("AUTH_OIDC_ISSUER", "").trim();
  }

  get authOidcAudience(): string[] {
    return this.config
      .get<string>("AUTH_OIDC_AUDIENCE", "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  get authOidcJwksUrl(): string {
    return this.config.get<string>("AUTH_OIDC_JWKS_URL", "").trim();
  }

  get authOidcAllowedAlgorithms(): string[] {
    return this.config
      .get<string>("AUTH_OIDC_ALLOWED_ALGORITHMS", "RS256")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  get authOidcClockToleranceSeconds(): number {
    return this.readPositiveNumber("AUTH_OIDC_CLOCK_TOLERANCE_SECONDS", 5);
  }

  get authPolicyVersion(): string {
    return this.config.get<string>("AUTH_POLICY_VERSION", "trusted-principal-v1").trim();
  }

  get authHeaderActorEnabled(): boolean {
    return this.authMode === "dev_headers";
  }

  get analysisArtifactMaxBytes(): number {
    return this.readPositiveNumber("ANALYSIS_ARTIFACT_MAX_BYTES", 256 * 1024);
  }

  get analysisTaskArtifactMaxBytes(): number {
    return this.readPositiveNumber("ANALYSIS_TASK_ARTIFACT_MAX_BYTES", 8 * 1024 * 1024);
  }

  get analysisDurableProvider(): AnalysisDurableProvider {
    const fallback = this.nodeEnv === "test" ? "in_memory" : "temporal";
    const configured = this.config
      .get<string>("ANALYSIS_DURABLE_PROVIDER", fallback)
      .trim()
      .toLowerCase();
    if (configured === "temporal" || configured === "in_memory") {
      return configured;
    }
    throw new Error(
      `ANALYSIS_DURABLE_PROVIDER 配置无效（${configured}），仅支持 temporal 或 in_memory。`
    );
  }

  get temporalAddress(): string {
    return this.config.get<string>("TEMPORAL_ADDRESS", "127.0.0.1:7233").trim();
  }

  get temporalNamespace(): string {
    return this.config.get<string>("TEMPORAL_NAMESPACE", "default").trim();
  }

  get temporalTaskQueue(): string {
    return this.config
      .get<string>("TEMPORAL_ANALYSIS_TASK_QUEUE", "text2sql-analysis-v1")
      .trim();
  }

  get temporalConnectionTimeoutMs(): number {
    return this.readPositiveNumber("TEMPORAL_CONNECTION_TIMEOUT_MS", 5_000);
  }

  get analysisEventPollIntervalMs(): number {
    return this.readPositiveNumber("ANALYSIS_EVENT_POLL_INTERVAL_MS", 500);
  }

  get analysisMultiWorkerMode(): "off" | "shadow" {
    return this.config
      .get<string>("ANALYSIS_MULTI_WORKER_MODE", "off")
      .trim()
      .toLowerCase() === "shadow"
      ? "shadow"
      : "off";
  }

  get analysisResearchEnabled(): boolean {
    return this.config.get<string>("ANALYSIS_RESEARCH_ENABLED", "false") === "true";
  }

  get knowledgeAssetLegacyFixtureMode(): boolean {
    return (
      this.config.get<string>("KNOWLEDGE_ASSET_LEGACY_FIXTURE_MODE", "false") ===
      "true"
    );
  }

  get analysisResearchProvider(): "tavily" {
    const configured = this.config
      .get<string>("ANALYSIS_RESEARCH_PROVIDER", "tavily")
      .trim()
      .toLowerCase();
    if (configured !== "tavily") {
      throw new Error(
        `ANALYSIS_RESEARCH_PROVIDER 配置无效（${configured}），当前仅支持 tavily。`
      );
    }
    return "tavily";
  }

  get tavilyApiKey(): string {
    return this.config.get<string>("TAVILY_API_KEY", "").trim();
  }

  get tavilyApiBaseUrl(): string {
    return this.config.get<string>("TAVILY_API_BASE_URL", "").trim();
  }

  get analysisResearchSearchTimeoutMs(): number {
    return this.readPositiveNumber("ANALYSIS_RESEARCH_SEARCH_TIMEOUT_MS", 10_000);
  }

  get analysisResearchExtractTimeoutMs(): number {
    return this.readPositiveNumber("ANALYSIS_RESEARCH_EXTRACT_TIMEOUT_MS", 20_000);
  }

  get analysisResearchMaxContentBytes(): number {
    return this.readPositiveNumber(
      "ANALYSIS_RESEARCH_MAX_CONTENT_BYTES",
      256 * 1024
    );
  }

  get analysisResearchDefaultRetentionDays(): number {
    return this.readPositiveNumber("ANALYSIS_RESEARCH_RETENTION_DAYS", 30);
  }

  get analysisResearchAllowedDomains(): string[] {
    return this.config
      .get<string>("ANALYSIS_RESEARCH_ALLOWED_DOMAINS", "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  get corsAllowedHeaders(): string[] {
    const common = [
      "content-type",
      "x-request-id",
      "x-workspace-id",
      "x-idempotency-key"
    ];
    if (this.authMode === "oidc_bearer") {
      return [...common, "authorization"];
    }
    return [
      ...common,
      "x-user-id",
      "x-user-role",
      "x-workspace-role",
      "x-workspace-admin-ids",
      "x-workspace-member-ids",
      "x-workspace-roles"
    ];
  }

  get sqlitePath(): string {
    const raw = this.config.get<string>("SQLITE_PATH", "data/sqlite/text2sql.db");
    return this.resolveConfiguredPath(raw);
  }

  get sqliteAllowedDirs(): string[] {
    const raw = this.config.get<string>(
      "SQLITE_ALLOWED_DIRS",
      "data/sqlite,data/uploads/datasources"
    );
    const parsed = raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => this.resolveConfiguredPath(item));
    return Array.from(new Set(parsed));
  }

  get redisUrl(): string {
    return this.config.get<string>("REDIS_URL", "");
  }

  get datasourceUploadDir(): string {
    const raw = this.config.get<string>(
      "DATASOURCE_UPLOAD_DIR",
      "data/uploads/datasources"
    );
    return this.resolveConfiguredPath(raw);
  }

  get datasourceUploadMaxBytes(): number {
    return Number(this.config.get<string>("DATASOURCE_UPLOAD_MAX_BYTES", "10485760"));
  }

  get datasourceConnectTimeoutMs(): number {
    return Number(this.config.get<string>("DATASOURCE_CONNECT_TIMEOUT_MS", "5000"));
  }

  get datasourceQueryTimeoutMs(): number {
    return Number(this.config.get<string>("DATASOURCE_QUERY_TIMEOUT_MS", "10000"));
  }

  get datasourceSecretKey(): string {
    return this.config.get<string>(
      "DATASOURCE_SECRET_KEY",
      "text2sql-dev-datasource-secret"
    );
  }

  get policyEvaluatorMode(): "workspace_table_permissions" {
    return "workspace_table_permissions";
  }

  get databaseUrl(): string {
    const explicit = this.config.get<string>("DATABASE_URL", "").trim();
    if (explicit) {
      return explicit;
    }

    const host = this.config.get<string>("POSTGRES_HOST", "localhost").trim();
    const port = this.config.get<string>("POSTGRES_PORT", "5432").trim();
    const database = this.config.get<string>("POSTGRES_DB", "").trim();
    const user = this.config.get<string>("POSTGRES_USER", "").trim();
    const password = this.config.get<string>("POSTGRES_PASSWORD", "").trim();
    const schema = this.config.get<string>("POSTGRES_SCHEMA", "public").trim();

    if (!host || !port || !database || !user || !password) {
      return "";
    }

    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
      password
    )}@${host}:${port}/${database}?schema=${encodeURIComponent(schema || "public")}`;
  }

  get llmProvider(): string {
    return this.config.get<string>("LLM_PROVIDER", "volcengine");
  }

  get llmApiKey(): string {
    return this.config.get<string>("LLM_API_KEY", "");
  }

  get llmBaseUrl(): string {
    return this.config.get<string>("LLM_BASE_URL", "");
  }

  get llmModel(): string {
    return this.config.get<string>("LLM_MODEL", "doubao-1.5-pro-32k");
  }

  get llmTimeoutMs(): number {
    return Number(this.config.get<string>("LLM_TIMEOUT_MS", "30000"));
  }

  get llmStreamTimeoutMs(): number {
    const fallback = this.llmTimeoutMs;
    const raw = this.config.get<string>("LLM_STREAM_TIMEOUT_MS", String(fallback));
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    this.logger.warn(
      `LLM_STREAM_TIMEOUT_MS 配置无效（${raw}），已回退到 LLM_TIMEOUT_MS=${fallback}。`
    );
    return fallback;
  }

  get llmMockMode(): boolean {
    return this.config.get<string>("LLM_MOCK_MODE", "false") === "true";
  }

  get embeddingProvider(): string {
    return this.config.get<string>("EMBEDDING_PROVIDER", this.llmProvider);
  }

  get embeddingApiKey(): string {
    return this.config.get<string>("EMBEDDING_API_KEY", this.llmApiKey);
  }

  get embeddingBaseUrl(): string {
    return this.config.get<string>("EMBEDDING_BASE_URL", this.llmBaseUrl);
  }

  get embeddingModel(): string {
    return this.config.get<string>("EMBEDDING_MODEL", "text-embedding-3-small");
  }

  get embeddingTimeoutMs(): number {
    const raw = this.config.get<string>("EMBEDDING_TIMEOUT_MS", String(this.llmTimeoutMs));
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    this.logger.warn(
      `EMBEDDING_TIMEOUT_MS 配置无效（${raw}），已回退到 LLM_TIMEOUT_MS=${this.llmTimeoutMs}。`
    );
    return this.llmTimeoutMs;
  }

  get embeddingDimensions(): number | undefined {
    const raw = this.config.get<string>("EMBEDDING_DIMENSIONS", "").trim();
    if (!raw) {
      return undefined;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    this.logger.warn(
      `EMBEDDING_DIMENSIONS 配置无效（${raw}），将忽略并使用 provider 默认维度。`
    );
    return undefined;
  }

  get embeddingVectorVersion(): string {
    return this.config.get<string>("EMBEDDING_VECTOR_VERSION", "v1");
  }

  get embeddingMockMode(): boolean {
    return this.config.get<string>("EMBEDDING_MOCK_MODE", "false") === "true";
  }

  get rerankProvider(): string {
    return this.config.get<string>("RERANK_PROVIDER", this.llmProvider);
  }

  get rerankApiKey(): string {
    return this.config.get<string>("RERANK_API_KEY", this.llmApiKey);
  }

  get rerankBaseUrl(): string {
    return this.config.get<string>("RERANK_BASE_URL", this.llmBaseUrl);
  }

  get rerankModel(): string {
    return this.config.get<string>("RERANK_MODEL", this.llmModel);
  }

  get rerankTimeoutMs(): number {
    const raw = this.config.get<string>("RERANK_TIMEOUT_MS", String(this.llmTimeoutMs));
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    this.logger.warn(
      `RERANK_TIMEOUT_MS 配置无效（${raw}），已回退到 LLM_TIMEOUT_MS=${this.llmTimeoutMs}。`
    );
    return this.llmTimeoutMs;
  }

  get rerankMockMode(): boolean {
    return this.config.get<string>("RERANK_MOCK_MODE", "false") === "true";
  }

  get agentPlanningScaffoldEnabled(): boolean {
    return this.config.get<string>("AGENT_PLANNING_SCAFFOLD_ENABLED", "false") === "true";
  }

  get agentRagRetrievalEnabled(): boolean {
    return this.config.get<string>("AGENT_RAG_RETRIEVAL_ENABLED", "true") === "true";
  }

  get clarificationHybridEnabled(): boolean {
    return this.config.get<string>("CLARIFICATION_HYBRID_ENABLED", "true") === "true";
  }

  get clarificationRulesOnlyKillSwitch(): boolean {
    return (
      this.config.get<string>(
        "CLARIFICATION_HYBRID_KILL_SWITCH_RULES_ONLY",
        this.config.get<string>("CLARIFICATION_RULES_ONLY_KILL_SWITCH", "false")
      ) === "true"
    );
  }

  get clarificationSemanticTimeoutMs(): number {
    const raw = this.config.get<string>(
      "CLARIFICATION_HYBRID_TIMEOUT_MS",
      this.config.get<string>("CLARIFICATION_SEMANTIC_TIMEOUT_MS", "1200")
    );
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    this.logger.warn(
      `CLARIFICATION_HYBRID_TIMEOUT_MS 配置无效（${raw}），已回退默认值 1200。`
    );
    return 1200;
  }

  get sqlSafetySoftWarnMaxLength(): number {
    return this.readNumber("SQL_SAFETY_SOFT_WARN_MAX_LENGTH", 600);
  }

  get r1GateWindowMinutes(): number {
    return this.readNumber("R1_GATE_WINDOW_MINUTES", 60);
  }

  get r1GateMinSamples(): number {
    return this.readNumber("R1_GATE_MIN_SAMPLES", 10);
  }

  get r1GateMinSuccessRate(): number {
    return this.readNumber("R1_GATE_MIN_SUCCESS_RATE", 0.95);
  }

  get r1GateMaxRejectionRate(): number {
    return this.readNumber("R1_GATE_MAX_REJECTION_RATE", 0.2);
  }

  get r1GateMaxHardFailureRate(): number {
    return this.readNumber("R1_GATE_MAX_HARD_FAILURE_RATE", 0.05);
  }

  get fallbackProviders(): string[] {
    const raw = this.config.get<string>("LLM_FALLBACK_PROVIDERS", "siliconflow,minimax");
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  get langsmithTracing(): boolean {
    return this.config.get<string>("LANGSMITH_TRACING", "false") === "true";
  }

  get langsmithApiKey(): string {
    return this.config.get<string>("LANGSMITH_API_KEY", "");
  }

  get langsmithEndpoint(): string {
    return this.config.get<string>(
      "LANGSMITH_ENDPOINT",
      "https://api.smith.langchain.com"
    );
  }

  get langsmithProject(): string {
    return this.config.get<string>("LANGSMITH_PROJECT", "text2sql");
  }

  get langsmithWorkspaceId(): string {
    return this.config.get<string>("LANGSMITH_WORKSPACE_ID", "");
  }

  get langsmithTimeoutMs(): number {
    return Number(this.config.get<string>("LANGSMITH_TIMEOUT_MS", "5000"));
  }

  get text2sqlAccuracyFixtureRoot(): string {
    const raw = this.config.get<string>(
      "TEXT2SQL_ACCURACY_FIXTURE_ROOT",
      "../../data/text2sql-accuracy"
    );
    return this.resolveConfiguredPath(raw);
  }

  get text2sqlAccuracyTrustedPublicKeys(): Record<string, string> {
    const raw = this.config
      .get<string>("TEXT2SQL_ACCURACY_TRUSTED_PUBLIC_KEYS_JSON", "{}")
      .trim();
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] =>
            entry[0].trim().length > 0 &&
            typeof entry[1] === "string" &&
            entry[1].trim().length > 0
        )
      );
    } catch {
      this.logger.warn(
        "TEXT2SQL_ACCURACY_TRUSTED_PUBLIC_KEYS_JSON 配置无效，将拒绝外部 Outcome Receipt。"
      );
      return {};
    }
  }

  get text2sqlAccuracyEvidenceMaxAgeMs(): number {
    return this.readPositiveNumber("TEXT2SQL_ACCURACY_EVIDENCE_MAX_AGE_MS", 3_600_000);
  }

  get text2sqlAccuracyMode(): "shadow" | "enforce" {
    return this.config.get<string>("TEXT2SQL_ACCURACY_MODE", "shadow") === "enforce"
      ? "enforce"
      : "shadow";
  }

  get text2sqlAccuracySupportedSlices(): string[] {
    return this.config
      .get<string>("TEXT2SQL_ACCURACY_SUPPORTED_SLICES", "sanitized-sqlite-reference")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  get text2sqlAccuracyGuidelineDigest(): string {
    return this.config.get<string>(
      "TEXT2SQL_ACCURACY_GUIDELINE_DIGEST",
      "data-agent-system-design-2026-07-17"
    );
  }

  get text2sqlExecutionTimeoutMs(): number {
    return this.readPositiveNumber("TEXT2SQL_EXECUTION_TIMEOUT_MS", 10_000);
  }

  get text2sqlExecutionMaxRows(): number {
    return this.readPositiveNumber("TEXT2SQL_EXECUTION_MAX_ROWS", 200);
  }

  get text2sqlExecutionMaxBytes(): number {
    return this.readPositiveNumber("TEXT2SQL_EXECUTION_MAX_BYTES", 2 * 1024 * 1024);
  }

  get text2sqlExecutionMaxAstNodes(): number {
    return this.readPositiveNumber("TEXT2SQL_EXECUTION_MAX_AST_NODES", 20_000);
  }

  get langsmithConfigured(): boolean {
    return Boolean(this.langsmithApiKey);
  }

  get langsmithReady(): boolean {
    return this.langsmithTracing && this.langsmithConfigured;
  }

  assertCriticalConfig(): void {
    const missing: string[] = [];
    if (!this.sqlitePath) {
      missing.push("SQLITE_PATH");
    }
    if (!this.databaseUrl) {
      this.logger.warn(
        "DATABASE_URL 未配置，系统将运行在内存持久化模式。"
      );
    }
    if (!this.redisUrl) {
      this.logger.warn(
        "REDIS_URL 未配置，系统将运行在内存缓冲模式。"
      );
    }
    if (!this.llmApiKey && !this.llmMockMode) {
      this.logger.warn(
        "LLM_API_KEY 未配置，实际调用 LLM 时会返回配置错误。"
      );
    }
    if (
      this.nodeEnv === "production" &&
      this.datasourceSecretKey === "text2sql-dev-datasource-secret"
    ) {
      this.logger.warn(
        "DATASOURCE_SECRET_KEY 使用了默认值，建议在生产环境配置自定义密钥。"
      );
    }
    if (this.langsmithTracing && !this.langsmithApiKey) {
      this.logger.warn(
        "LANGSMITH_TRACING 已启用但 LANGSMITH_API_KEY 未配置，系统将降级为本地可观测模式。"
      );
    }
    if (this.nodeEnv === "production" && this.authMode !== "oidc_bearer") {
      throw new Error(
        "生产环境必须使用 AUTH_MODE=oidc_bearer，禁止启用客户端身份请求头。"
      );
    }
    if (
      this.nodeEnv === "production" &&
      this.analysisDurableProvider !== "temporal"
    ) {
      throw new Error(
        "生产环境必须使用 ANALYSIS_DURABLE_PROVIDER=temporal，禁止以内存 adapter 承载自治任务。"
      );
    }
    if (this.nodeEnv === "production" && this.knowledgeAssetLegacyFixtureMode) {
      throw new Error(
        "生产环境禁止 KNOWLEDGE_ASSET_LEGACY_FIXTURE_MODE，Memory/Skill 必须使用 canonical store。"
      );
    }
    if (this.analysisResearchEnabled && !this.tavilyApiKey) {
      missing.push("TAVILY_API_KEY");
    }
    if (this.analysisDurableProvider === "temporal") {
      if (!this.temporalAddress) {
        missing.push("TEMPORAL_ADDRESS");
      }
      if (!this.temporalNamespace) {
        missing.push("TEMPORAL_NAMESPACE");
      }
      if (!this.temporalTaskQueue) {
        missing.push("TEMPORAL_ANALYSIS_TASK_QUEUE");
      }
    }
    if (this.authMode === "oidc_bearer") {
      if (!this.authOidcIssuer) {
        missing.push("AUTH_OIDC_ISSUER");
      }
      if (this.authOidcAudience.length === 0) {
        missing.push("AUTH_OIDC_AUDIENCE");
      }
      if (!this.authOidcJwksUrl) {
        missing.push("AUTH_OIDC_JWKS_URL");
      }
      if (this.authOidcAllowedAlgorithms.length === 0) {
        missing.push("AUTH_OIDC_ALLOWED_ALGORITHMS");
      }
    }
    if (!this.authPolicyVersion) {
      missing.push("AUTH_POLICY_VERSION");
    }
    if (missing.length > 0) {
      throw new Error(`缺少必要配置: ${missing.join(", ")}`);
    }
  }

  assertAnalysisWorkerConfig(): void {
    if (this.analysisDurableProvider !== "temporal") {
      throw new Error("analysis-worker 只能在 temporal durable provider 下启动。");
    }
    const missing = [
      ["TEMPORAL_ADDRESS", this.temporalAddress],
      ["TEMPORAL_NAMESPACE", this.temporalNamespace],
      ["TEMPORAL_ANALYSIS_TASK_QUEUE", this.temporalTaskQueue]
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`analysis-worker 缺少关键配置: ${missing.join(", ")}`);
    }
  }

  private readNumber(key: string, defaultValue: number): number {
    const raw = this.config.get<string>(key, String(defaultValue));
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    this.logger.warn(`${key} 配置无效（${raw}），已回退默认值 ${defaultValue}。`);
    return defaultValue;
  }

  private readPositiveNumber(key: string, defaultValue: number): number {
    const parsed = this.readNumber(key, defaultValue);
    if (parsed > 0) {
      return parsed;
    }
    this.logger.warn(`${key} 必须大于 0，已回退默认值 ${defaultValue}。`);
    return defaultValue;
  }

  private resolveConfiguredPath(raw: string): string {
    if (isAbsolute(raw)) {
      return resolve(raw);
    }

    const direct = resolve(process.cwd(), raw);
    const fallback = resolve(process.cwd(), "../../", raw);
    if (existsSync(direct) || !existsSync(fallback)) {
      return direct;
    }
    return fallback;
  }
}
