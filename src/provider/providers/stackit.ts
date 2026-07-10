import { OpenAICompatibleExecutor } from "./openai_compatible";

export class StackitExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "stackit",
      baseURL: "https://api.openai-compat.openai-stackit.com/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
