import { Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, IsString, Min } from "class-validator";

export class DeployModelingGraphDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  policyVersion!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  draftRevision?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  representativeSqlSamples?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rollbackToRevision?: number;
}
