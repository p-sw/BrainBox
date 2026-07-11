import { OpenAICompatibleExecutor } from "./openai_compatible";

export class LmStudioExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "lmstudio",
      baseURL: "http://127.0.0.1:1234/v1",
      apiKey: opts.apiKey || "lm-studio",
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
      supportsResponseFormat: false,
    });
  }
}
