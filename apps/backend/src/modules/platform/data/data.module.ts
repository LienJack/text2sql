import { Module } from "@nestjs/common";
import { PlatformDataAccessModule } from "./access.module";
import { PlatformDataBootstrapModule } from "./bootstrap.module";
import { PlatformDataPersistenceModule } from "./persistence.module";
import { PlatformDataQueryModule } from "./query.module";

@Module({
  imports: [
    PlatformDataPersistenceModule,
    PlatformDataAccessModule,
    PlatformDataQueryModule,
    PlatformDataBootstrapModule
  ],
  exports: [
    PlatformDataPersistenceModule,
    PlatformDataAccessModule,
    PlatformDataQueryModule,
    PlatformDataBootstrapModule
  ]
})
export class PlatformDataModule {}
