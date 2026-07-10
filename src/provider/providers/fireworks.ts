import { OpenAICompatibleExecutor } from "./openai_compatible";

export class FireworksExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "fireworks",
      baseURL: "https://api.fireworks.ai/inference/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
