import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class KimiAdapter extends OpenAiBaseAdapter {
  readonly provider = "kimi" as const;

  constructor() {
    super("https://api.moonshot.cn/v1");
  }
}
