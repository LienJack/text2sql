import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Length } from "class-validator";

const PROMPT_TEMPLATE_SCOPES = ["global", "workspace", "datasource"] as const;
const PROMPT_TEMPLATE_STATUSES = ["draft", "active", "archived"] as const;
const PROMPT_TEMPLATE_SCENES = ["sql", "analysis", "sql_generation"] as const;

const trimString = (value: unknown): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreatePromptTemplateDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 64)
  name!: string;

  @Transform(({ value }) => trimString(value))
  @IsIn(PROMPT_TEMPLATE_SCENES)
  scene!: "sql" | "analysis" | "sql_generation";

  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 8000)
  content!: string;

  @Transform(({ value }) => trimString(value))
  @IsIn(PROMPT_TEMPLATE_SCOPES)
  scope!: "global" | "workspace" | "datasource";

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 128)
  scopeKey?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(1, 128)
  scopeId?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(PROMPT_TEMPLATE_STATUSES)
  status?: "draft" | "active" | "archived";
}
