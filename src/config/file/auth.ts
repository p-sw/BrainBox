import z from "zod";
import { configFile } from "../loader";

// ponytail: provider-specific knobs (region, project, deployment, endpoint, account)
// live alongside apiKey in the same record. .loose() lets each provider add fields
// without us having to enumerate them in the schema.
//
// Reference — keys read by each provider (defaults: env vars listed in parens):
//
//   openrouter        apiKey
//   openai            apiKey
//   mistral           apiKey
//   deepseek          apiKey
//   groq              apiKey
//   cerebras          apiKey
//   fireworks         apiKey
//   together          apiKey
//   xai               apiKey
//   moonshot          apiKey
//   nvidia            apiKey
//   deepinfra         apiKey
//   302ai             apiKey
//   digitalocean      apiKey
//   helicone          apiKey
//   scaleway          apiKey
//   venice            apiKey
//   nebius            apiKey
//   ovhcloud          apiKey
//   stackit           apiKey
//   gmi               apiKey
//   zai               apiKey
//   zenmux            apiKey
//   MiniMax           apiKey
//   ionet             apiKey
//   baseten           apiKey
//   cortecs           apiKey
//   huggingface       apiKey
//   lmstudio          apiKey (no real key — any value works)
//   ollama            apiKey (no real key — any value works)
//   ollama-cloud      apiKey
//   llamacpp          apiKey (no real key — any value works)
//   vercel            apiKey
//   llmgateway        apiKey
//   cloudflare-gateway apiKey + accountId (CLOUDFLARE_ACCOUNT_ID) + gatewayId (CLOUDFLARE_GATEWAY_ID)
//   cloudflare-workers apiKey + accountId (CLOUDFLARE_ACCOUNT_ID)
//   sap-aicore        apiKey + baseURL (SAP_AI_CORE_BASE_URL)
//   azure-openai      apiKey + resource (AZURE_OPENAI_RESOURCE) + apiVersion (AZURE_OPENAI_API_VERSION)
//   azure-cognitive   apiKey + resource (AZURE_COGNITIVE_RESOURCE) + apiVersion (AZURE_COGNITIVE_API_VERSION)
//   anthropic         apiKey + baseURL (ANTHROPIC_BASE_URL) + apiVersion
//   bedrock           apiKey = "accessKeyId:secretAccessKey" + region (AWS_REGION) + sessionToken (AWS_SESSION_TOKEN)
//   vertex            apiKey (OAuth access token, GOOGLE_ACCESS_TOKEN) + project (GOOGLE_CLOUD_PROJECT) + region (GOOGLE_CLOUD_REGION)
//   copilot           apiKey (pre-exchanged Copilot session token)
//   gitlab-duo        apiKey (GitLab PAT) + baseURL (GITLAB_BASE_URL)
export type AuthRecord = Record<string, string>;
export type AuthFile = Record<string, AuthRecord>;

const AuthSchema = z.record(
  z.string(),
  z.object({ apiKey: z.string().default("") }).loose(),
) as z.ZodType<AuthFile>;

const authCfg = configFile<AuthFile>("auth.yaml", { schema: AuthSchema });

export const PROVIDER_EXTRA_FIELDS: Record<string, string[]> = {
  "cloudflare-gateway": ["accountId", "gatewayId"],
  "cloudflare-workers": ["accountId"],
  "sap-aicore": ["baseURL"],
  "azure-openai": ["resource", "apiVersion"],
  "azure-cognitive": ["resource", "apiVersion"],
  anthropic: ["baseURL", "apiVersion"],
  bedrock: ["region", "sessionToken"],
  vertex: ["project", "region"],
  "gitlab-duo": ["baseURL"],
  "snowflake-cortex": ["account"],
};

export function readAuthFile(): AuthFile {
  return authCfg.read();
}

export function setProviderAuth(
  provider: string,
  fields: AuthRecord,
): AuthFile {
  return authCfg.update((auth) => ({
    ...auth,
    [provider]: { ...(auth[provider] ?? {}), ...fields },
  }));
}

export function removeProviderAuth(provider: string): AuthFile {
  return authCfg.update((auth) => {
    const next = { ...auth };
    delete next[provider];
    return next;
  });
}

export default authCfg.read();
