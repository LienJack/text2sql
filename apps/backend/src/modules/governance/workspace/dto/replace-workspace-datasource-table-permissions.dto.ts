import { Transform, Type } from "class-transformer";
import { IsArray, IsInt, IsString, Min } from "class-validator";

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
  return Array.from(deduped);
};

export class ReplaceWorkspaceDatasourceTablePermissionsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  policyVersion!: number;

  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => toNormalizedTableNames(value))
  tableNames!: string[];
}
