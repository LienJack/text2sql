import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class VolcengineAdapter extends OpenAiBaseAdapter {
  readonly provider = "volcengine" as const;

  constructor() {
    super("https://ark.cn-beijing.volces.com/api/v3");
  }
}
