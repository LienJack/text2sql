import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";

const toOptionalTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
};

export class ListWorkspaceDatasourceTablePermissionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  keyword?: string;
}
