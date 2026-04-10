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
    return this.config.get<string>("DATABASE_URL", "");
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

  get fallbackProviders(): string[] {
    const raw = this.config.get<string>("LLM_FALLBACK_PROVIDERS", "siliconflow,minimax");
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
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
    if (!this.llmApiKey) {
      this.logger.warn(
        "LLM_API_KEY 未配置，将使用规则路由生成 SQL。"
      );
    }
    if (missing.length > 0) {
      throw new Error(`缺少必要配置: ${missing.join(", ")}`);
    }
  }
}
