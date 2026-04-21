import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

const USER_STATUSES = ["active", "disabled"] as const;

const blankToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

export class ListUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Length(1, 100)
  keyword?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @Length(1, 64)
  workspaceId?: string;
}
