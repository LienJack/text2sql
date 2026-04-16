import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppConfigService } from "./modules/config/app-config.service";
import { requestIdMiddleware } from "./modules/middleware/request-id.middleware";
import { requestActorMiddleware } from "./modules/auth/request-actor.middleware";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  app.enableCors({
    origin: config.corsAllowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "x-request-id",
      "x-user-id",
      "x-user-role",
      "x-workspace-id",
      "x-workspace-role",
      "x-workspace-admin-ids",
      "x-workspace-member-ids",
      "x-workspace-roles",
      "x-idempotency-key"
    ],
    credentials: false
  });

  app.use(requestIdMiddleware);
  app.use(requestActorMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );
  config.assertCriticalConfig();
  await app.listen(config.port);
}

void bootstrap();
