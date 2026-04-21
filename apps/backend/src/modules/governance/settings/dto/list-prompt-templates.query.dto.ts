import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

const PROMPT_TEMPLATE_SCOPES = ["global", "workspace", "datasource"] as const;
const PROMPT_TEMPLATE_STATUSES = ["draft", "active", "archived"] as const;
const PROMPT_TEMPLATE_SCENES = ["sql", "analysis", "sql_generation"] as const;

const trimString = (value: unknown): unknown =>
  typeof value === "string" ? value.trim() : value;

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return undefined;
};

export class ListPromptTemplatesQueryDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 128)
  query?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(PROMPT_TEMPLATE_SCENES)
  scene?: "sql" | "analysis" | "sql_generation";

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(PROMPT_TEMPLATE_SCOPES)
  scope?: "global" | "workspace" | "datasource";

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 128)
  scopeKey?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(PROMPT_TEMPLATE_STATUSES)
  status?: "draft" | "active" | "archived";

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  includeDeleted?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
