import { Injectable, Module, OnModuleInit } from "@nestjs/common";
import { DatasourceAccessPolicyService } from "../auth/datasource-access-policy.service";
import { AppConfigModule } from "../config/config.module";
import { AppConfigService } from "../config/app-config.service";
import { PersistenceRetryService } from "./cache/persistence-retry.service";
import { RedisBufferService } from "./cache/redis-buffer.service";
import { AuditLogRepository } from "./persistence/audit-log.repository";
import { ChatRepository } from "./persistence/chat.repository";
import { DatasourceRepository } from "./persistence/datasource.repository";
import { LlmConfigRepository } from "./persistence/llm-config.repository";
import { UserRepository } from "./persistence/user.repository";
import { WorkspaceRepository } from "./persistence/workspace.repository";
import { WorkspaceDatasourcePolicyRepository } from "./persistence/workspace-datasource-policy.repository";
import { FileDatasourceExecutorService } from "./query/file-datasource-executor.service";
import { MysqlExecutorService } from "./query/mysql-executor.service";
import { PostgresExecutorService } from "./query/postgres-executor.service";
import { QueryExecutorRouterService } from "./query/query-executor-router.service";
import { SqlTableAccessGuardService } from "./query/sql-table-access-guard.service";
import { SqliteExecutorService } from "./query/sqlite-executor.service";
import { SqliteQueryService } from "./sqlite/sqlite-query.service";

@Injectable()
class DataBootstrapService implements OnModuleInit {
  constructor(
    private readonly config: AppConfigService,
    private readonly datasourceRepository: DatasourceRepository
  ) {}

  async onModuleInit(): Promise<void> {
    await this.datasourceRepository.ensureBaselineSqliteDatasource(
      this.config.sqlitePath
    );
  }
}

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
    WorkspaceRepository,
    DatasourceAccessPolicyService,
    SqlTableAccessGuardService,
    QueryExecutorRouterService,
    SqliteExecutorService,
    MysqlExecutorService,
    PostgresExecutorService,
    FileDatasourceExecutorService,
    DataBootstrapService
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
    WorkspaceRepository,
    DatasourceAccessPolicyService,
    SqlTableAccessGuardService,
    QueryExecutorRouterService
  ]
})
export class DataModule {}
