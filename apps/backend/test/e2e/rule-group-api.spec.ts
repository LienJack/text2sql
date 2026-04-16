import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";

describe("rule group api (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(requestIdMiddleware);
    app.use(requestActorMiddleware);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 404 for retired rule-group routes", async () => {
    const server = app.getHttpServer();
    const actorHeaders = {
      "x-user-id": "admin-rule-group-retired",
      "x-user-role": "admin"
    };

    const urls = [
      "/api/v1/system/rule-groups",
      "/api/v1/system/rule-groups/rg-legacy",
      "/api/v1/system/rule-groups/rg-legacy/rules"
    ];

    for (const url of urls) {
      const response = await request(server).get(url).set(actorHeaders);
      expect(response.status).toBe(404);
    }
  });
});
