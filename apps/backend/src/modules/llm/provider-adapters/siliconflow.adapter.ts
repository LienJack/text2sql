import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class SiliconflowAdapter extends OpenAiBaseAdapter {
  readonly provider = "siliconflow" as const;

  constructor() {
    super("https://api.siliconflow.cn/v1");
  }
}
