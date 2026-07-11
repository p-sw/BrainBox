import { OpenAICompatibleExecutor } from "./openai_compatible";

// International. Accepts pay-as-you-go API Keys and Token Plan Subscription
// Keys (sk-cp-...) — same endpoint, different billing pools.
export class MiniMaxExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "minimax",
      baseURL: "https://api.minimax.io/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
