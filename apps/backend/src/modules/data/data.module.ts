import { Injectable, Module, OnModuleInit } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { AppConfigService } from "../config/app-config.service";
import { DatasourceModule } from "../datasource/datasource.module";
import { DatasourceRegistryService } from "../datasource/datasource-registry.service";
import { RedisBufferService } from "./cache/redis-buffer.service";
import { ChatRepository } from "./persistence/chat.repository";
import { SqliteQueryService } from "./sqlite/sqlite-query.service";

@Injectable()
class DataBootstrapService implements OnModuleInit {
  constructor(
    private readonly config: AppConfigService,
    private readonly registry: DatasourceRegistryService
  ) {}

  onModuleInit(): void {
    this.registry.register({
      id: "sqlite_main",
      type: "sqlite",
      readonly: true,
      location: this.config.sqlitePath,
      enabled: true
    });
  }
}

@Module({
  imports: [AppConfigModule, DatasourceModule],
  providers: [
    SqliteQueryService,
    RedisBufferService,
    ChatRepository,
    DataBootstrapService
  ],
  exports: [SqliteQueryService, RedisBufferService, ChatRepository]
})
export class DataModule {}
