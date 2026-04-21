import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { SemanticRegistryService } from "./semantic-registry.service";

@Module({
  imports: [AppConfigModule],
  providers: [SemanticRegistryService],
  exports: [SemanticRegistryService]
})
export class SemanticRegistryModule {}
