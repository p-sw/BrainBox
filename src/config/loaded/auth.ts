import z from "zod";
import { parseConfigFile } from "../loader";

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
//   snowflake-cortex  apiKey (programmatic access token / JWT) + account (SNOWFLAKE_ACCOUNT)

const ProviderAuthSchema = z
  .object({
    apiKey: z.string().default(""),
  })
  .loose();

const AuthSchema = z.record(z.string(), ProviderAuthSchema);

const authConfig = parseConfigFile("auth.yaml", {
  schema: AuthSchema,
});

export default authConfig;
