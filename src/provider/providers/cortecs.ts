import { OpenAICompatibleExecutor } from "./openai_compatible";

export class CortecsExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "cortecs",
      baseURL: "https://api.cortecs.ai/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
