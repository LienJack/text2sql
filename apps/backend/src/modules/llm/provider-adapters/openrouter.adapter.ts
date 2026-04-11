import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class OpenRouterAdapter extends OpenAiBaseAdapter {
  readonly provider = "openrouter" as const;

  constructor() {
    super("https://openrouter.ai/api/v1");
  }
}
