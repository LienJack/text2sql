import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class TencentHunyuanAdapter extends OpenAiBaseAdapter {
  readonly provider = "tencent-hunyuan" as const;

  constructor() {
    super("https://api.hunyuan.cloud.tencent.com/v1");
  }
}
