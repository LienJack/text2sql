import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { PersistenceRetryService } from "../../data/cache/persistence-retry.service";
import { RedisBufferService } from "../../data/cache/redis-buffer.service";
import { AuditLogRepository } from "../../data/persistence/audit-log.repository";
import { ChatRepository } from "../../data/persistence/chat.repository";
import { DatasourceRepository } from "../../data/persistence/datasource.repository";
import { LlmConfigRepository } from "../../data/persistence/llm-config.repository";
import { RagTaskConfigRepository } from "../../data/persistence/rag-task-config.repository";
import { UserRepository } from "../../data/persistence/user.repository";
import { WorkspaceRepository } from "../../data/persistence/workspace.repository";
import { WorkspaceDatasourcePolicyRepository } from "../../data/persistence/workspace-datasource-policy.repository";
import { SqliteQueryService } from "../../data/sqlite/sqlite-query.service";
import { AnalysisCommandOutboxRepository } from "./persistence/analysis-command-outbox.repository";
import { AnalysisLedgerPrismaService } from "./persistence/analysis-ledger-prisma.service";
import { AnalysisTaskRepository } from "./persistence/analysis-task.repository";
import { ModelingGraphRepository } from "./persistence/modeling-graph.repository";
import { ModelingGraphValidator } from "./persistence/modeling-graph.validator";

@Module({
  imports: [AppConfigModule],
  providers: [
    SqliteQueryService,
    RedisBufferService,
    PersistenceRetryService,
    ChatRepository,
    DatasourceRepository,
    WorkspaceDatasourcePolicyRepository,
    ModelingGraphRepository,
    ModelingGraphValidator,
    AuditLogRepository,
    LlmConfigRepository,
    RagTaskConfigRepository,
    UserRepository,
    WorkspaceRepository,
    AnalysisLedgerPrismaService,
    AnalysisTaskRepository,
    AnalysisCommandOutboxRepository
  ],
  exports: [
    SqliteQueryService,
    RedisBufferService,
    PersistenceRetryService,
    ChatRepository,
    DatasourceRepository,
    WorkspaceDatasourcePolicyRepository,
    ModelingGraphRepository,
    ModelingGraphValidator,
    AuditLogRepository,
    LlmConfigRepository,
    RagTaskConfigRepository,
    UserRepository,
    WorkspaceRepository,
    AnalysisLedgerPrismaService,
    AnalysisTaskRepository,
    AnalysisCommandOutboxRepository
  ]
})
export class PlatformDataPersistenceModule {}
