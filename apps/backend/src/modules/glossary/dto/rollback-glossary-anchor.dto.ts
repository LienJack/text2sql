import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const GLOSSARY_SCOPES = ["global", "datasource"] as const;

const trimString = (value: unknown): unknown =>
  typeof value === "string" ? value.trim() : value;

export class RollbackGlossaryAnchorDto {
  @Transform(({ value }) => trimString(value))
  @IsIn(GLOSSARY_SCOPES)
  scope!: "global" | "datasource";

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  datasourceId?: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  targetAnchorId!: string;

  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(300)
  rollbackReason?: string;
}
