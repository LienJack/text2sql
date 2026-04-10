import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { AppConfigService } from "./app-config.service";

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === "test"
    })
  ],
  providers: [AppConfigService],
  exports: [AppConfigService]
})
export class AppConfigModule {}
