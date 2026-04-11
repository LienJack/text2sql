import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class DeepSeekAdapter extends OpenAiBaseAdapter {
  readonly provider = "deepseek" as const;

  constructor() {
    super("https://api.deepseek.com/v1");
  }
}
