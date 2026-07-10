import { OpenAICompatibleExecutor } from "./openai_compatible";
import { readAuthString } from "../llm";

export class SapAiCoreExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
    auth?: Record<string, unknown>;
  }) {
    const baseURL =
      readAuthString(opts.auth, "baseURL", "SAP_AI_CORE_BASE_URL") ||
      "https://api.ai.prod.eu-central-1.aws.ml.hana.ondemand.com/v2";
    super({
      providerName: "sap-aicore",
      baseURL,
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
