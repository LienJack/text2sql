import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

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
    if (missing.length > 0) {
      throw new Error(`缺少必要配置: ${missing.join(", ")}`);
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
