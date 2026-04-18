import { Transform } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min
} from "class-validator";

const GLOSSARY_SCOPES = ["global", "datasource"] as const;
const GLOSSARY_CONFLICT_RESOLUTIONS = ["priority_then_updated_at"] as const;

const normalizeSynonyms = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped);
};

const trimString = (value: unknown): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreateGlossaryTermDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  term!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  definition!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => normalizeSynonyms(value))
  synonyms?: string[];

  @Transform(({ value }) => trimString(value))
  @IsIn(GLOSSARY_SCOPES)
  scope!: "global" | "datasource";

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  datasourceId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(GLOSSARY_CONFLICT_RESOLUTIONS)
  conflictResolution?: "priority_then_updated_at";

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
