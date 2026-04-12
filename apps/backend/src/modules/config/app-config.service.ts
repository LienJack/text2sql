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
    return Number(this.config.get<string>("PORT", "3000"));
  }

  get corsAllowedOrigins(): string[] {
    const raw = this.config.get<string>(
      "CORS_ALLOWED_ORIGINS",
      "http://localhost:3001"
    );
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  get sqlitePath(): string {
    const raw = this.config.get<string>("SQLITE_PATH", "data/sqlite/text2sql.db");
    if (isAbsolute(raw)) {
      return raw;
    }
    const direct = resolve(process.cwd(), raw);
    if (existsSync(direct)) {
      return direct;
    }
    const fallback = resolve(process.cwd(), "../../", raw);
    return fallback;
  }

  get redisUrl(): string {
    return this.config.get<string>("REDIS_URL", "");
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

  get llmMockMode(): boolean {
    return this.config.get<string>("LLM_MOCK_MODE", "false") === "true";
  }

  get agentPlanningScaffoldEnabled(): boolean {
    return this.config.get<string>("AGENT_PLANNING_SCAFFOLD_ENABLED", "false") === "true";
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
}
