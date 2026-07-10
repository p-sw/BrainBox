import { OpenAICompatibleExecutor } from "./openai_compatible";

export class OllamaExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
      apiKey: opts.apiKey || "ollama",
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
