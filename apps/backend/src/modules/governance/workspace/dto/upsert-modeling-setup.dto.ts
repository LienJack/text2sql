import { Transform, Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min } from "class-validator";

const toNormalizedTableNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped).sort((left, right) => left.localeCompare(right));
};

const toNormalizedRecommendationIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
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
  return Array.from(deduped).sort((left, right) => left.localeCompare(right));
};

export class UpsertModelingSetupDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  policyVersion?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Transform(({ value, obj }) => toNormalizedTableNames(value ?? obj?.selectedTableNames))
  selectedTables!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value, obj }) =>
    toNormalizedRecommendationIds(value ?? obj?.acceptedSuggestionIds)
  )
  selectedRecommendationIds?: string[];
}
