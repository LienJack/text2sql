import { Injectable, Module, OnModuleInit } from "@nestjs/common";
import { AppConfigService } from "../../config/app-config.service";
import { AppConfigModule } from "../../config/config.module";
import { DatasourceRepository } from "../../data/persistence/datasource.repository";
import { PlatformDataPersistenceModule } from "./persistence.module";

@Injectable()
export class DataBootstrapService implements OnModuleInit {
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
  imports: [AppConfigModule, PlatformDataPersistenceModule],
  providers: [DataBootstrapService],
  exports: [DataBootstrapService]
})
export class PlatformDataBootstrapModule {}
