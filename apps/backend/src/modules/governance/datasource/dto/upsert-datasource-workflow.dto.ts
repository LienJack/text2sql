import {
  IsBoolean,
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
const workflowModes = ["create", "edit"] as const;

class WorkflowDatasourcePayloadDto {
  @IsOptional()
  @IsString()
  datasourceId?: string;

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

class WorkflowWorkspaceCreateDto {
  @IsString()
  name!: string;
}

class WorkflowWorkspacePayloadDto {
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowWorkspaceCreateDto)
  create?: WorkflowWorkspaceCreateDto;
}

export class UpsertDatasourceWorkflowDto {
  @IsIn(workflowModes)
  mode!: "create" | "edit";

  @IsOptional()
  @IsString()
  datasourceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowDatasourcePayloadDto)
  datasource?: WorkflowDatasourcePayloadDto;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowWorkspaceCreateDto)
  workspaceCreate?: WorkflowWorkspaceCreateDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowWorkspacePayloadDto)
  workspace?: WorkflowWorkspacePayloadDto;
}
