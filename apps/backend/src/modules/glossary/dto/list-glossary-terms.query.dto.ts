import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const GLOSSARY_SCOPES = ["global", "datasource"] as const;
const GLOSSARY_TERM_STATUSES = ["active", "inactive"] as const;

const trimString = (value: unknown): unknown =>
  typeof value === "string" ? value.trim() : value;

export class ListGlossaryTermsQueryDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(GLOSSARY_SCOPES)
  scope?: "global" | "datasource";

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  datasourceId?: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(GLOSSARY_TERM_STATUSES)
  status?: "active" | "inactive";

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

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
