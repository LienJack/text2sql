import { IsEmail, IsIn, IsOptional, IsString, Length } from "class-validator";
import { Transform } from "class-transformer";

const workspaceMemberRoles = ["admin", "member"] as const;

export class AddWorkspaceMemberDto {
  @IsString()
  @Length(1, 128)
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  userId!: string;

  @IsOptional()
  @IsString()
  @IsIn(workspaceMemberRoles)
  role?: "admin" | "member";

  @IsOptional()
  @IsString()
  @Length(1, 128)
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  account?: string;

  @IsOptional()
  @IsEmail()
  @Length(1, 256)
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  email?: string;
}
