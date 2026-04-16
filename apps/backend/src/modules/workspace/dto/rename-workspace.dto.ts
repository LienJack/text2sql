import { IsString, Length } from "class-validator";
import { Transform } from "class-transformer";

export class RenameWorkspaceDto {
  @IsString()
  @Length(1, 64)
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  name!: string;
}
