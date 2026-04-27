import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min
} from "class-validator";

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
}
