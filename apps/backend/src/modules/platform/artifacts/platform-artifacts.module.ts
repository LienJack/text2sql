import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { AnalysisArtifactRepository } from "../data/persistence/analysis-artifact.repository";
import { PlatformDataPersistenceModule } from "../data/persistence.module";
import { ArtifactPayloadStorePort } from "./artifact-payload-store.port";
import { PostgresArtifactPayloadStoreService } from "./postgres-artifact-payload-store.service";

@Module({
  imports: [AppConfigModule, PlatformDataPersistenceModule],
  providers: [
    PostgresArtifactPayloadStoreService,
    AnalysisArtifactRepository,
    {
      provide: ArtifactPayloadStorePort,
      useExisting: PostgresArtifactPayloadStoreService
    }
  ],
  exports: [
    ArtifactPayloadStorePort,
    PostgresArtifactPayloadStoreService,
    AnalysisArtifactRepository
  ]
})
export class PlatformArtifactsModule {}
