import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class TongyiAdapter extends OpenAiBaseAdapter {
  readonly provider = "tongyi" as const;

  constructor() {
    super("https://dashscope.aliyuncs.com/compatible-mode/v1");
  }
}
