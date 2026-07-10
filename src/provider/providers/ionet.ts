import { OpenAICompatibleExecutor } from "./openai_compatible";

export class IoNetExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "ionet",
      baseURL: "https://api.intelligence.io.solutions/api/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
