import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { ChatService } from "../../src/modules/chat/chat.service";

describe("data flow", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
  });

  it("should persist session and messages through repository flow", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const chatService = moduleRef.get(ChatService);

    const session = await chatService.createSession();
    await chatService.sendMessage(session.id, "请统计订单状态分布");

    const messages = await chatService.listMessages(session.id);
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });
});

