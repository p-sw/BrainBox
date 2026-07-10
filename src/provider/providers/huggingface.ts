import { OpenAICompatibleExecutor } from "./openai_compatible";

export class HuggingFaceExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "huggingface",
      baseURL: "https://router.huggingface.co/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
