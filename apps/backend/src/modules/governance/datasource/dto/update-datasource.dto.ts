import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min
} from "class-validator";
import type { DatasourceType } from "@text2sql/shared-types";

const datasourceTypes: DatasourceType[] = [
  "sqlite",
  "mysql",
  "postgresql",
  "csv",
  "excel"
];

export class UpdateDatasourceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(datasourceTypes)
  type?: DatasourceType;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;

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
}
