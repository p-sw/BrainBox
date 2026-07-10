import { OpenAICompatibleExecutor } from "./openai_compatible";

export class LlmGatewayExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "llmgateway",
      baseURL: "https://api.llmgateway.io/v1",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
