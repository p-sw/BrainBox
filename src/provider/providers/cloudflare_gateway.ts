import { OpenAICompatibleExecutor } from "./openai_compatible";
import { readAuthString } from "../llm";

export class CloudflareGatewayExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
    auth?: Record<string, unknown>;
  }) {
    const accountId = readAuthString(
      opts.auth,
      "accountId",
      "CLOUDFLARE_ACCOUNT_ID",
    );
    const gatewayId = readAuthString(
      opts.auth,
      "gatewayId",
      "CLOUDFLARE_GATEWAY_ID",
    );
    const baseURL =
      accountId && gatewayId
        ? `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`
        : readAuthString(opts.auth, "baseURL", "CLOUDFLARE_AI_GATEWAY_URL") ||
          "https://gateway.ai.cloudflare.com/v1";
    super({
      providerName: "cloudflare-gateway",
      baseURL,
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
  }
}
