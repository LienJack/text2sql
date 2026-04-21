import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { PersistenceRetryService } from "../../data/cache/persistence-retry.service";
import { RedisBufferService } from "../../data/cache/redis-buffer.service";
import { AuditLogRepository } from "../../data/persistence/audit-log.repository";
import { ChatRepository } from "../../data/persistence/chat.repository";
import { DatasourceRepository } from "../../data/persistence/datasource.repository";
import { LlmConfigRepository } from "../../data/persistence/llm-config.repository";
import { UserRepository } from "../../data/persistence/user.repository";
import { WorkspaceRepository } from "../../data/persistence/workspace.repository";
import { WorkspaceDatasourcePolicyRepository } from "../../data/persistence/workspace-datasource-policy.repository";
import { SqliteQueryService } from "../../data/sqlite/sqlite-query.service";

@Module({
  imports: [AppConfigModule],
  providers: [
    SqliteQueryService,
    RedisBufferService,
    PersistenceRetryService,
    ChatRepository,
    DatasourceRepository,
    WorkspaceDatasourcePolicyRepository,
    AuditLogRepository,
    LlmConfigRepository,
    UserRepository,
    WorkspaceRepository
  ],
  exports: [
    SqliteQueryService,
    RedisBufferService,
    PersistenceRetryService,
    ChatRepository,
    DatasourceRepository,
    WorkspaceDatasourcePolicyRepository,
    AuditLogRepository,
    LlmConfigRepository,
    UserRepository,
    WorkspaceRepository
  ]
})
export class PlatformDataPersistenceModule {}
