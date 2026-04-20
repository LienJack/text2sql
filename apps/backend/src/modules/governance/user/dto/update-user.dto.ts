import { Type } from "class-transformer";
import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested
} from "class-validator";
import { UserVariableDto } from "./user-variable.dto";

const USER_STATUSES = ["active", "disabled"] as const;

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  account?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @IsOptional()
  @IsEmail()
  @Length(1, 120)
  email?: string;

  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  workspaceIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserVariableDto)
  variables?: UserVariableDto[];
}
