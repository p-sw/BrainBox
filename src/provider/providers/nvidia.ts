import { OpenAICompatibleExecutor } from "./openai_compatible";

export class NvidiaExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "nvidia",
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
