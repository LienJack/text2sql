import { Transform, Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, IsString, Min } from "class-validator";

const normalizeString = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const normalizeSqlSamples = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
};

export class PublishWorkspaceRelationshipGraphDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  policyVersion!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  draftRevision!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => normalizeSqlSamples(value))
  representativeSqlSamples?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rollbackToRevision?: number;
}
