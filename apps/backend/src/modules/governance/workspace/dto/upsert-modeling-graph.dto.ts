import { Transform, Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, Min } from "class-validator";

const toArrayOrUndefined = (value: unknown): Record<string, unknown>[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item)
  );
};

export class UpsertModelingGraphDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  policyVersion!: number;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => toArrayOrUndefined(value))
  models?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => toArrayOrUndefined(value))
  relationships?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => toArrayOrUndefined(value))
  calculatedFields?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => toArrayOrUndefined(value))
  views?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => toArrayOrUndefined(value))
  schemaChanges?: Record<string, unknown>[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  draftRevision?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetRevision?: number;
}
