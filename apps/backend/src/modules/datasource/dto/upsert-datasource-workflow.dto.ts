import {
  ArrayMinSize,
  IsArray,
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
import type {
  DatasourcePolicyEffect,
  DatasourcePolicySubjectType
} from "../../data/persistence/workspace-datasource-policy.repository";

const datasourceTypes: DatasourceType[] = [
  "sqlite",
  "mysql",
  "postgresql",
  "csv",
  "excel"
];
const workflowModes = ["create", "edit"] as const;
const aclSubjectTypes: DatasourcePolicySubjectType[] = ["role", "user"];
const aclEffects: DatasourcePolicyEffect[] = ["allow", "deny"];

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

class WorkflowAclPayloadDto {
  @IsIn(aclSubjectTypes)
  subjectType!: DatasourcePolicySubjectType;

  @IsString()
  subjectId!: string;

  @IsIn(aclEffects)
  effect!: DatasourcePolicyEffect;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tableNames!: string[];

  @IsOptional()
  @IsString()
  reason?: string;
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

  @ValidateNested()
  @Type(() => WorkflowAclPayloadDto)
  acl!: WorkflowAclPayloadDto;
}
