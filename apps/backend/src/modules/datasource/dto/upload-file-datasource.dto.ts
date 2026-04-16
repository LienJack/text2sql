import { IsOptional, IsString } from "class-validator";

export class UploadFileDatasourceDto {
  @IsOptional()
  @IsString()
  name?: string;
}
