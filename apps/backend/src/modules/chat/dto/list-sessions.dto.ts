import { IsIn, IsOptional } from "class-validator";
import type { SessionSyncStatus } from "@text2sql/shared-types";

const syncStatuses: SessionSyncStatus[] = ["healthy", "pending", "degraded"];

export class ListSessionsDto {
  @IsOptional()
  @IsIn(syncStatuses)
  status?: SessionSyncStatus;
}
