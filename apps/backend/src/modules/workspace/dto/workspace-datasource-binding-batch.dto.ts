import { Transform } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
};

export class WorkspaceDatasourceBindingBatchDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Transform(({ value }) => toStringArray(value))
  datasourceIds!: string[];
}
