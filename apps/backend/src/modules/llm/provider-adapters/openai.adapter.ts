import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class OpenAiAdapter extends OpenAiBaseAdapter {
  readonly provider = "openai" as const;

  constructor() {
    super("https://api.openai.com/v1");
  }
}
