import { OpenAICompatibleExecutor } from "./openai_compatible";

export class OllamaCloudExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "ollama-cloud",
      baseURL: "https://api.ollama.cloud/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
