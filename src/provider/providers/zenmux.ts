import { OpenAICompatibleExecutor } from "./openai_compatible";

export class ZenMuxExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "zenmux",
      baseURL: "https://zenmux.ai/api/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
