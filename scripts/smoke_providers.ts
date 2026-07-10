// Smoke test: verify every provider can be constructed and exposes the right
// providerName + models fields. Runs offline (no network).
import type { LLMExecutor as LLMExecutorType } from "../src/provider/llm";
import { LLMExecutor } from "../src/provider/llm";
import { OpenRouterExecutor } from "../src/provider/providers/openrouter";
import { OpenAIExecutor } from "../src/provider/providers/openai";
import { MistralExecutor } from "../src/provider/providers/mistral";
import { DeepSeekExecutor } from "../src/provider/providers/deepseek";
import { GroqExecutor } from "../src/provider/providers/groq";
import { CerebrasExecutor } from "../src/provider/providers/cerebras";
import { FireworksExecutor } from "../src/provider/providers/fireworks";
import { TogetherExecutor } from "../src/provider/providers/together";
import { XAIExecutor } from "../src/provider/providers/xai";
import { MoonshotExecutor } from "../src/provider/providers/moonshot";
import { NvidiaExecutor } from "../src/provider/providers/nvidia";
import { DeepInfraExecutor } from "../src/provider/providers/deepinfra";
import { Ai302Executor } from "../src/provider/providers/302ai";
import { DigitalOceanExecutor } from "../src/provider/providers/digitalocean";
import { HeliconeExecutor } from "../src/provider/providers/helicone";
import { ScalewayExecutor } from "../src/provider/providers/scaleway";
import { VeniceExecutor } from "../src/provider/providers/venice";
import { NebiusExecutor } from "../src/provider/providers/nebius";
import { OvhCloudExecutor } from "../src/provider/providers/ovhcloud";
import { StackitExecutor } from "../src/provider/providers/stackit";
import { GmiExecutor } from "../src/provider/providers/gmi";
import { ZaiExecutor } from "../src/provider/providers/zai";
import { ZenMuxExecutor } from "../src/provider/providers/zenmux";
import { MiniMaxExecutor } from "../src/provider/providers/MiniMax";
import { IoNetExecutor } from "../src/provider/providers/ionet";
import { BasetenExecutor } from "../src/provider/providers/baseten";
import { CortecsExecutor } from "../src/provider/providers/cortecs";
import { HuggingFaceExecutor } from "../src/provider/providers/huggingface";
import { LmStudioExecutor } from "../src/provider/providers/lmstudio";
import { OllamaExecutor } from "../src/provider/providers/ollama";
import { OllamaCloudExecutor } from "../src/provider/providers/ollama_cloud";
import { LlamaCppExecutor } from "../src/provider/providers/llamacpp";
import { VercelExecutor } from "../src/provider/providers/vercel";
import { LlmGatewayExecutor } from "../src/provider/providers/llmgateway";
import { CloudflareGatewayExecutor } from "../src/provider/providers/cloudflare_gateway";
import { CloudflareWorkersExecutor } from "../src/provider/providers/cloudflare_workers";
import { SapAiCoreExecutor } from "../src/provider/providers/sap_aicore";
import { AzureOpenAIExecutor } from "../src/provider/providers/azure_openai";
import { AzureCognitiveExecutor } from "../src/provider/providers/azure_cognitive";
import { AnthropicExecutor } from "../src/provider/providers/anthropic";
import { BedrockExecutor } from "../src/provider/providers/bedrock";
import { VertexExecutor } from "../src/provider/providers/vertex";
import { CopilotExecutor } from "../src/provider/providers/copilot";
import { GitLabDuoExecutor } from "../src/provider/providers/gitlab_duo";
import { SnowflakeCortexExecutor } from "../src/provider/providers/snowflake_cortex";

type Ctor = new (opts: {
  apiKey: string;
  conversationModel: string;
  identityModel: string;
  auth?: Record<string, unknown>;
}) => LLMExecutorType;

const entries: Array<[string, Ctor]> = [
  ["openrouter", OpenRouterExecutor],
  ["openai", OpenAIExecutor],
  ["mistral", MistralExecutor],
  ["deepseek", DeepSeekExecutor],
  ["groq", GroqExecutor],
  ["cerebras", CerebrasExecutor],
  ["fireworks", FireworksExecutor],
  ["together", TogetherExecutor],
  ["xai", XAIExecutor],
  ["moonshot", MoonshotExecutor],
  ["nvidia", NvidiaExecutor],
  ["deepinfra", DeepInfraExecutor],
  ["302ai", Ai302Executor],
  ["digitalocean", DigitalOceanExecutor],
  ["helicone", HeliconeExecutor],
  ["scaleway", ScalewayExecutor],
  ["venice", VeniceExecutor],
  ["nebius", NebiusExecutor],
  ["ovhcloud", OvhCloudExecutor],
  ["stackit", StackitExecutor],
  ["gmi", GmiExecutor],
  ["zai", ZaiExecutor],
  ["zenmux", ZenMuxExecutor],
  ["MiniMax", MiniMaxExecutor],
  ["ionet", IoNetExecutor],
  ["baseten", BasetenExecutor],
  ["cortecs", CortecsExecutor],
  ["huggingface", HuggingFaceExecutor],
  ["lmstudio", LmStudioExecutor],
  ["ollama", OllamaExecutor],
  ["ollama-cloud", OllamaCloudExecutor],
  ["llamacpp", LlamaCppExecutor],
  ["vercel", VercelExecutor],
  ["llmgateway", LlmGatewayExecutor],
  ["cloudflare-gateway", CloudflareGatewayExecutor],
  ["cloudflare-workers", CloudflareWorkersExecutor],
  ["sap-aicore", SapAiCoreExecutor],
  ["azure-openai", AzureOpenAIExecutor],
  ["azure-cognitive", AzureCognitiveExecutor],
  ["anthropic", AnthropicExecutor],
  ["bedrock", BedrockExecutor],
  ["vertex", VertexExecutor],
  ["copilot", CopilotExecutor],
  ["gitlab-duo", GitLabDuoExecutor],
  ["snowflake-cortex", SnowflakeCortexExecutor],
];

const authExtras: Record<string, unknown> = {
  accountId: "acct",
  gatewayId: "gw",
  region: "us-east-1",
  project: "proj",
  resource: "res",
  apiVersion: "2024-08-01-preview",
  baseURL: "https://example.com",
  account: "acct",
};

let failed = 0;
for (const [name, ctor] of entries) {
  const instance = new ctor({
    apiKey: "test-key",
    conversationModel: "conv-model",
    identityModel: "id-model",
    auth: authExtras,
  });
  if (instance.providerName !== name) {
    console.error(`MISMATCH for ${name}: got ${instance.providerName}`);
    failed++;
    continue;
  }
  if (
    instance.models.conversation !== "conv-model" ||
    instance.models.identity !== "id-model"
  ) {
    console.error(`MODELS MISMATCH for ${name}:`, instance.models);
    failed++;
    continue;
  }
  if (
    typeof instance.call !== "function" ||
    typeof instance.chatWithTools !== "function"
  ) {
    console.error(`MISSING METHODS for ${name}`);
    failed++;
    continue;
  }
}

if (failed > 0) {
  console.error(`FAILED ${failed}/${entries.length}`);
  process.exit(1);
}

console.log(`OK: ${entries.length} providers instantiate cleanly`);

// ponytail: instead of importing the index (which calls init() and exits on
// bad config), walk the same list and verify the export names in
// src/provider/index.ts statically. This is a static check on the source
// string of the file — if a new provider is added to `entries` but not to
// the index's register() call, this fails.
import { readFileSync } from "fs";
import { join } from "path";
const indexPath = join(import.meta.dir, "..", "src", "provider", "index.ts");
const indexSrc = readFileSync(indexPath, "utf8");
const notRegistered: string[] = [];
for (const [name] of entries) {
  if (!indexSrc.includes(`register("${name}"`)) {
    notRegistered.push(name);
  }
}
if (notRegistered.length > 0) {
  console.error("NOT REGISTERED in provider/index.ts:", notRegistered);
  process.exit(1);
}
console.log(`OK: ${entries.length} providers registered in provider/index.ts`);

void LLMExecutor;
