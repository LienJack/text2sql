import { Module } from "@nestjs/common";
import { DataModule } from "../data/data.module";
import { AppConfigModule } from "../config/config.module";
import { DatasourceController } from "./datasource.controller";
import { DatasourceRegistryService } from "./datasource-registry.service";
import { DatasourceService } from "./datasource.service";

@Module({
  imports: [AppConfigModule, DataModule],
  controllers: [DatasourceController],
  providers: [DatasourceRegistryService, DatasourceService],
  exports: [DatasourceRegistryService, DatasourceService]
})
export class DatasourceModule {}
