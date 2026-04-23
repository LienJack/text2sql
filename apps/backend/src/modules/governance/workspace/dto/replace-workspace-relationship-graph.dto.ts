import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested
} from "class-validator";

const normalizeString = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

class RelationshipBridgeEndpointDto {
  @IsString()
  @Transform(({ value }) => normalizeString(value))
  dataset!: string;

  @IsString()
  @Transform(({ value }) => normalizeString(value).toLowerCase())
  table!: string;

  @IsString()
  @Transform(({ value }) => normalizeString(value).toLowerCase())
  column!: string;
}

class RelationshipBridgeDto {
  @ValidateNested()
  @Type(() => RelationshipBridgeEndpointDto)
  left!: RelationshipBridgeEndpointDto;

  @ValidateNested()
  @Type(() => RelationshipBridgeEndpointDto)
  right!: RelationshipBridgeEndpointDto;

  @IsIn(["eq"])
  operator!: "eq";

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence!: number;
}

class RelationshipGraphEdgeDto {
  @IsString()
  @Transform(({ value }) => normalizeString(value))
  id!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizeString(value))
  name?: string;

  @ValidateNested()
  @Type(() => RelationshipBridgeDto)
  bridge!: RelationshipBridgeDto;
}

export class ReplaceWorkspaceRelationshipGraphDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  policyVersion!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RelationshipGraphEdgeDto)
  edges!: RelationshipGraphEdgeDto[];
}
