import { OpenAICompatibleExecutor } from "./openai_compatible";

export class VercelExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "vercel",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
