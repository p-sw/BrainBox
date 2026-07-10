import { OpenAICompatibleExecutor } from "./openai_compatible";

export class DigitalOceanExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "digitalocean",
      baseURL: "https://api.digitalocean.com/v2/gen-ai/openai/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
