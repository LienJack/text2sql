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

const GLOSSARY_TERM_STATUSES = ["active", "inactive"] as const;
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

export class UpdateGlossaryTermDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  definition?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => normalizeSynonyms(value))
  synonyms?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(GLOSSARY_TERM_STATUSES)
  status?: "active" | "inactive";

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(GLOSSARY_CONFLICT_RESOLUTIONS)
  conflictResolution?: "priority_then_updated_at";

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
