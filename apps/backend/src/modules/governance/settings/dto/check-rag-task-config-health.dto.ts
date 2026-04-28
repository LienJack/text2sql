import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";

export class CheckRagTaskConfigDraftDto {
  @IsOptional()
  @IsString()
  @Length(0, 64)
  provider?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  model?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32768)
  dimensions?: number;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  vectorVersion?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120000)
  timeoutMs?: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class CheckRagTaskConfigHealthDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  sampleQuery?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  sampleCandidates?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32768)
  expectedDimensions?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CheckRagTaskConfigDraftDto)
  draft?: CheckRagTaskConfigDraftDto;
}
