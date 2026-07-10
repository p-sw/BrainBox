import { OpenAICompatibleExecutor } from "./openai_compatible";

export class OvhCloudExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "ovhcloud",
      baseURL: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
