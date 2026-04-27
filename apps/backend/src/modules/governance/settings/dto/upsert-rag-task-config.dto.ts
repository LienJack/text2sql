import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class UpsertRagTaskConfigDto {
  @IsString()
  @Length(1, 64)
  provider!: string;

  @IsString()
  @Length(1, 120)
  model!: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
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
  @Length(1, 64)
  vectorVersion?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120000)
  timeoutMs?: number;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
