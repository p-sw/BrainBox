import { OpenAICompatibleExecutor } from "./openai_compatible";

export class LlamaCppExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "llamacpp",
      baseURL: "http://127.0.0.1:8080/v1",
      apiKey: opts.apiKey || "llama.cpp",
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
