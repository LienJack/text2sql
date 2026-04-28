import { IsBoolean, IsIn, IsOptional, IsString, Length } from "class-validator";
import type { LlmProviderCode } from "@text2sql/shared-types";

const SUPPORTED_PROVIDERS: LlmProviderCode[] = [
  "openai",
  "gemini",
  "deepseek",
  "kimi",
  "volcengine",
  "siliconflow",
  "openrouter",
  "minimax",
  "tencent-hunyuan",
  "tongyi"
];

export class CreateProviderDto {
  @IsString()
  @IsIn(SUPPORTED_PROVIDERS)
  provider!: LlmProviderCode;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
