import { IsIn, IsString } from "class-validator";

const workspaceMemberRoles = ["admin", "member"] as const;

export class UpdateWorkspaceMemberRoleDto {
  @IsString()
  @IsIn(workspaceMemberRoles)
  role!: "admin" | "member";
}
