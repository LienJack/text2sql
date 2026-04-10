import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { FreeTextSqlExtractor } from "./free-text-sql-extractor";
import { OpenAiCompatibleClient } from "./openai-compatible.client";
import { ProviderRouterService } from "./provider-router.service";

@Module({
  imports: [AppConfigModule],
  providers: [OpenAiCompatibleClient, FreeTextSqlExtractor, ProviderRouterService],
  exports: [OpenAiCompatibleClient, FreeTextSqlExtractor, ProviderRouterService]
})
export class LlmModule {}
