import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppConfigService } from "./modules/config/app-config.service";
import { requestIdMiddleware } from "./modules/middleware/request-id.middleware";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  app.enableCors({
    origin: config.corsAllowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "x-request-id"],
    credentials: false
  });

  app.use(requestIdMiddleware);
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
