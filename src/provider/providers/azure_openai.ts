import { logger } from "@/utils/logger";
import { OpenAICompatibleExecutor } from "./openai_compatible";
import { readAuthString, type ReasoningEffort } from "../llm";

export class AzureOpenAIExecutor extends OpenAICompatibleExecutor {
  private readonly apiVersion: string;

  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
    auth?: Record<string, unknown>;
  }) {
    const resource = readAuthString(
      opts.auth,
      "resource",
      "AZURE_OPENAI_RESOURCE",
    );
    const apiVersion =
      readAuthString(opts.auth, "apiVersion", "AZURE_OPENAI_API_VERSION") ||
      "2024-08-01-preview";
    if (!resource) {
      logger
        .child("llm:azure-openai")
        .warn(
          "azure-openai: no resource configured; set auth.azure-openai.resource or AZURE_OPENAI_RESOURCE",
        );
    }
    super({
      providerName: "azure-openai",
      baseURL: `https://${resource || "__resource__"}.openai.azure.com/openai/deployments`,
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
    });
    this.apiVersion = apiVersion;
  }

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
