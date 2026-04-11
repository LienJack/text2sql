import { IsOptional, IsString } from "class-validator";

export class CreateSessionDto {
  @IsOptional()
  @IsString()
  datasource?: string;

  @IsOptional()
  @IsString()
  modelCatalogId?: string;
}
