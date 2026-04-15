import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  datasource!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  modelCatalogId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  workspaceId?: string;
}
