import { OpenAICompatibleExecutor } from "./openai_compatible";

export class DeepInfraExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "deepinfra",
      baseURL: "https://api.deepinfra.com/v1/openai",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
