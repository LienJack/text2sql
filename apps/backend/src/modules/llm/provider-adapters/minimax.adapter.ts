import { OpenAiBaseAdapter } from "./openai-base.adapter";

export class MinimaxAdapter extends OpenAiBaseAdapter {
  readonly provider = "minimax" as const;

  constructor() {
    super("https://api.minimax.chat/v1");
  }
}
