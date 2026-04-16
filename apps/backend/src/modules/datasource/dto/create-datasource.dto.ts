import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import type { DatasourceType } from "@text2sql/shared-types";

const creatableTypes: DatasourceType[] = ["sqlite", "mysql", "postgresql"];

export class CreateDatasourceDto {
  @IsString()
  name!: string;

  @IsIn(creatableTypes)
  type!: DatasourceType;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  database?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}
