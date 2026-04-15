import { IsIn, IsOptional, IsString } from "class-validator";
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
  datasource?: string;

  @IsOptional()
  @IsIn([...sessionListViews])
  view?: SessionListView;
}
