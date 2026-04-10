import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { ProviderRouterService } from "./provider-router.service";

@Module({
  imports: [AppConfigModule],
  providers: [ProviderRouterService],
  exports: [ProviderRouterService]
})
export class LlmModule {}

