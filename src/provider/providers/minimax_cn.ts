import { OpenAICompatibleExecutor } from "./openai_compatible";

// China region. Accepts pay-as-you-go API Keys and Token Plan Subscription
// Keys (sk-cp-...) — same endpoint, different billing pools.
export class MiniMaxCnExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "minimax-cn",
      baseURL: "https://api.minimaxi.com/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
