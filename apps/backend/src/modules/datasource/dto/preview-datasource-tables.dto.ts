import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";
import type { DatasourceType } from "@text2sql/shared-types";

const datasourceTypes: DatasourceType[] = [
  "sqlite",
  "mysql",
  "postgresql",
  "csv",
  "excel"
];

const previewModes = ["create", "edit"] as const;

class PreviewDatasourcePayloadDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(datasourceTypes)
  type?: DatasourceType;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
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

export class PreviewDatasourceTablesDto {
  @IsIn(previewModes)
  mode!: "create" | "edit";

  @IsOptional()
  @IsString()
  datasourceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PreviewDatasourcePayloadDto)
  datasource?: PreviewDatasourcePayloadDto;
}
