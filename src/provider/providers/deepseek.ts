import { OpenAICompatibleExecutor } from "./openai_compatible";

export class DeepSeekExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "deepseek",
      baseURL: "https://api.deepseek.com/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
