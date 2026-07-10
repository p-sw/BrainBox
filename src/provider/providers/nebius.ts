import { OpenAICompatibleExecutor } from "./openai_compatible";

export class NebiusExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "nebius",
      baseURL: "https://api.tokenfactory.nebius.com/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
