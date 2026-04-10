import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";

describe("bootstrap", () => {
  it("should compile AppModule", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    expect(moduleRef).toBeDefined();
  });
});

