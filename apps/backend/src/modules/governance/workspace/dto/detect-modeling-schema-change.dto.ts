import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";

export class DetectModelingSchemaChangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  policyVersion?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeResolved?: boolean;
}
