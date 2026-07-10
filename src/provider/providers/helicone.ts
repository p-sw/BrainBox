import { OpenAICompatibleExecutor } from "./openai_compatible";

export class HeliconeExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "helicone",
      baseURL: "https://oai.helicone.ai/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
