import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { FileDatasourceExecutorService } from "../../data/query/file-datasource-executor.service";
import { MysqlExecutorService } from "../../data/query/mysql-executor.service";
import { PostgresExecutorService } from "../../data/query/postgres-executor.service";
import { QueryExecutorRouterService } from "../../data/query/query-executor-router.service";
import { RowFilterRewriteService } from "../../data/query/row-filter-rewrite.service";
import { SqlTableAccessGuardService } from "../../data/query/sql-table-access-guard.service";
import { SqliteExecutorService } from "../../data/query/sqlite-executor.service";
import { RelationshipDryRunService } from "./query/relationship-dry-run.service";
import { BoundedQueryExecutionService } from "./query/bounded-query-execution.service";
import { RelationshipPublishGateFacade } from "./query/relationship-publish-gate.facade";
import { DatasourceSchemaSnapshotService } from "./schema/datasource-schema-snapshot.service";
import { SqlCatalogResolverService } from "./sql-analysis/sql-catalog-resolver.service";
import { SqlDialectAnalyzerService } from "./sql-analysis/sql-dialect-analyzer.service";
import { PlatformDataPersistenceModule } from "./persistence.module";

@Module({
  imports: [AppConfigModule, PlatformDataPersistenceModule],
  providers: [
    RowFilterRewriteService,
    SqlTableAccessGuardService,
    QueryExecutorRouterService,
    BoundedQueryExecutionService,
    RelationshipDryRunService,
    RelationshipPublishGateFacade,
    DatasourceSchemaSnapshotService,
    SqlDialectAnalyzerService,
    SqlCatalogResolverService,
    SqliteExecutorService,
    MysqlExecutorService,
    PostgresExecutorService,
    FileDatasourceExecutorService
  ],
  exports: [
    RowFilterRewriteService,
    SqlTableAccessGuardService,
    QueryExecutorRouterService,
    BoundedQueryExecutionService,
    RelationshipDryRunService,
    RelationshipPublishGateFacade,
    DatasourceSchemaSnapshotService,
    SqlDialectAnalyzerService,
    SqlCatalogResolverService
  ]
})
export class PlatformDataQueryModule {}
