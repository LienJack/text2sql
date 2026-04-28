import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateNested
} from "class-validator";

const MAX_TABLES = 50;
const MAX_ENTITY_MAPPINGS = 20;
const MAX_BUSINESS_CONSTRAINTS = 20;

class ContextEnvelopeTimeRangeDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  from?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  to?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;
}

class ContextEnvelopeEntityMappingDto {
  @IsString()
  @Length(1, 128)
  entity!: string;

  @IsString()
  @Length(1, 128)
  mappedTo!: string;
}

export class ContextEnvelopeDto {
  @IsOptional()
  @IsString()
  @Length(1, 300)
  metricDefinition?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContextEnvelopeTimeRangeDto)
  timeRange?: ContextEnvelopeTimeRangeDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ENTITY_MAPPINGS)
  @ValidateNested({ each: true })
  @Type(() => ContextEnvelopeEntityMappingDto)
  entityMappings?: ContextEnvelopeEntityMappingDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TABLES)
  @IsString({ each: true })
  @Length(1, 128, { each: true })
  mustIncludeTables?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TABLES)
  @IsString({ each: true })
  @Length(1, 128, { each: true })
  mustExcludeTables?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BUSINESS_CONSTRAINTS)
  @IsString({ each: true })
  @Length(1, 300, { each: true })
  businessConstraints?: string[];
}
