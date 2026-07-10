import { OpenAICompatibleExecutor } from "./openai_compatible";

export class CerebrasExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "cerebras",
      baseURL: "https://api.cerebras.ai/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
