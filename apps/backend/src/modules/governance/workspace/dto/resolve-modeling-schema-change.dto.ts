import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Min, ValidateIf } from "class-validator";

const normalizeSchemaChangeId = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

export class ResolveModelingSchemaChangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  policyVersion?: number;

  @Transform(({ value }) => normalizeSchemaChangeId(value))
  @ValidateIf((dto: ResolveModelingSchemaChangeDto) => !dto.changeId)
  @IsString()
  schemaChangeId?: string;

  @Transform(({ value }) => normalizeSchemaChangeId(value))
  @ValidateIf((dto: ResolveModelingSchemaChangeDto) => !dto.schemaChangeId)
  @IsString()
  changeId?: string;
}
