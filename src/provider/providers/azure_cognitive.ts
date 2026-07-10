import { OpenAICompatibleExecutor } from "./openai_compatible";
import { readAuthString, type ReasoningEffort } from "../llm";

export class AzureCognitiveExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
    auth?: Record<string, unknown>;
  }) {
    const resource = readAuthString(
      opts.auth,
      "resource",
      "AZURE_COGNITIVE_RESOURCE",
    );
    super({
      providerName: "azure-cognitive",
      baseURL: `https://${resource || "__resource__"}.cognitiveservices.azure.com/openai/deployments`,
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
    this.apiVersion =
      readAuthString(opts.auth, "apiVersion", "AZURE_COGNITIVE_API_VERSION") ||
      "2024-08-01-preview";
  }

  private readonly apiVersion: string;

  protected override buildRequestUrl(
    model: string,
    _reasoningEffort: ReasoningEffort | undefined,
  ): string {
    const url = new URL(
      `${this.baseURL}/${encodeURIComponent(model)}/chat/completions`,
    );
    url.searchParams.set("api-version", this.apiVersion);
    return url.toString();
  }
}
