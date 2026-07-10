import { OpenAICompatibleExecutor } from "./openai_compatible";

export class MiniMaxExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "MiniMax",
      baseURL: "https://api.MiniMax.chat/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
