import { Transform } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString } from "class-validator";

const normalizeString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
};

export class WorkspaceDatasourceTableAclReplaceDto {
  @IsString()
  @IsIn(["role", "user"])
  @Transform(({ value }) => normalizeString(value).toLowerCase())
  subjectType!: "role" | "user";

  @IsString()
  @Transform(({ value }) => normalizeString(value))
  subjectId!: string;

  @IsString()
  @IsIn(["allow", "deny"])
  @Transform(({ value }) => normalizeString(value).toLowerCase())
  effect!: "allow" | "deny";

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Transform(({ value }) => toStringArray(value))
  tableNames!: string[];

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  reason?: string;
}
