import { Module } from "@nestjs/common";
import { tavily } from "@tavily/core";
import { AppConfigModule } from "../../config/config.module";
import { AppConfigService } from "../../config/app-config.service";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { KNOWLEDGE_RESEARCH_CONTRACT } from "../contracts/knowledge-research.contract";
import {
  TAVILY_RESEARCH_CLIENT,
  TavilyResearchConnector
} from "./connectors/tavily-research.connector";
import { ResearchConnectorPort } from "./contracts/research-connector.port";
import { ResearchCoverageService } from "./research-coverage.service";
import { ResearchFacade } from "./research.facade";
import { ResearchSourceSnapshotService } from "./source-snapshot.service";
import { ResearchSourcePolicyService } from "./source-policy/research-source-policy.service";

@Module({
  imports: [AppConfigModule, PlatformDataPersistenceModule],
  providers: [
    {
      provide: TAVILY_RESEARCH_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.analysisResearchEnabled && config.tavilyApiKey
          ? tavily({
              apiKey: config.tavilyApiKey,
              ...(config.tavilyApiBaseUrl
                ? { apiBaseURL: config.tavilyApiBaseUrl }
                : {}),
              clientName: "text2sql-bounded-research"
            })
          : null
    },
    TavilyResearchConnector,
    {
      provide: ResearchConnectorPort,
      useExisting: TavilyResearchConnector
    },
    ResearchSourcePolicyService,
    ResearchSourceSnapshotService,
    ResearchCoverageService,
    ResearchFacade,
    {
      provide: KNOWLEDGE_RESEARCH_CONTRACT,
      useExisting: ResearchFacade
    }
  ],
  exports: [
    ResearchFacade,
    KNOWLEDGE_RESEARCH_CONTRACT,
    ResearchSourcePolicyService,
    ResearchSourceSnapshotService,
    ResearchCoverageService
  ]
})
export class ResearchModule {}
