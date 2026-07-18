import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppConfigService } from "./modules/config/app-config.service";
import { requestIdMiddleware } from "./modules/middleware/request-id.middleware";
import { createRequestActorMiddleware } from "./modules/auth/request-actor.middleware";
import { TrustedPrincipalService } from "./modules/governance/auth/trusted-principal.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  app.enableCors({
    origin: config.corsAllowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: config.corsAllowedHeaders,
    credentials: false
  });

  app.use(requestIdMiddleware);
  app.use(createRequestActorMiddleware(app.get(TrustedPrincipalService)));
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
