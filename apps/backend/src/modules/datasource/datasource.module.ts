import { Module } from "@nestjs/common";
import { DatasourceRegistryService } from "./datasource-registry.service";

@Module({
  providers: [DatasourceRegistryService],
  exports: [DatasourceRegistryService]
})
export class DatasourceModule {}

