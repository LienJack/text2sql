import { IsIn, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";
import type { SessionSyncStatus } from "@text2sql/shared-types";

const syncStatuses: SessionSyncStatus[] = ["healthy", "pending", "degraded"];
export const sessionListViews = ["current", "readonly-history", "all"] as const;
export type SessionListView = (typeof sessionListViews)[number];

export class ListSessionsDto {
  @IsOptional()
  @IsIn(syncStatuses)
  status?: SessionSyncStatus;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  datasource?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value
  )
  workspaceId?: string;

  @IsOptional()
  @IsIn([...sessionListViews])
  view?: SessionListView;
}
