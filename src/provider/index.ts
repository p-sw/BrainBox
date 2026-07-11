export {
  LLMExecutor,
  defaultReasoningEffort,
  readAuthString,
  listProviderNames,
  type CallOptions,
  type ChatAssistantMessage,
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ProviderCtor,
  type ReasoningEffort,
  type ToolCall,
} from "./llm";

import { LLMExecutor } from "./llm";
import { OpenRouterExecutor } from "./providers/openrouter";
import { OpenAIExecutor } from "./providers/openai";
import { MistralExecutor } from "./providers/mistral";
import { DeepSeekExecutor } from "./providers/deepseek";
import { GroqExecutor } from "./providers/groq";
import { CerebrasExecutor } from "./providers/cerebras";
import { FireworksExecutor } from "./providers/fireworks";
import { TogetherExecutor } from "./providers/together";
import { XAIExecutor } from "./providers/xai";
import { MoonshotExecutor } from "./providers/moonshot";
import { NvidiaExecutor } from "./providers/nvidia";
import { DeepInfraExecutor } from "./providers/deepinfra";
import { Ai302Executor } from "./providers/302ai";
import { DigitalOceanExecutor } from "./providers/digitalocean";
import { HeliconeExecutor } from "./providers/helicone";
import { ScalewayExecutor } from "./providers/scaleway";
import { VeniceExecutor } from "./providers/venice";
import { NebiusExecutor } from "./providers/nebius";
import { OvhCloudExecutor } from "./providers/ovhcloud";
import { StackitExecutor } from "./providers/stackit";
import { GmiExecutor } from "./providers/gmi";
import { ZaiExecutor } from "./providers/zai";
import { ZenMuxExecutor } from "./providers/zenmux";
import { MiniMaxExecutor, MiniMaxCnExecutor } from "./providers/minimax";
import { IoNetExecutor } from "./providers/ionet";
import { BasetenExecutor } from "./providers/baseten";
import { CortecsExecutor } from "./providers/cortecs";
import { HuggingFaceExecutor } from "./providers/huggingface";
import { LmStudioExecutor } from "./providers/lmstudio";
import { OllamaExecutor } from "./providers/ollama";
import { OllamaCloudExecutor } from "./providers/ollama_cloud";
import { LlamaCppExecutor } from "./providers/llamacpp";
import { VercelExecutor } from "./providers/vercel";
import { LlmGatewayExecutor } from "./providers/llmgateway";
import { CloudflareGatewayExecutor } from "./providers/cloudflare_gateway";
import { CloudflareWorkersExecutor } from "./providers/cloudflare_workers";
import { SapAiCoreExecutor } from "./providers/sap_aicore";
import { AzureOpenAIExecutor } from "./providers/azure_openai";
import { AzureCognitiveExecutor } from "./providers/azure_cognitive";
import { AnthropicExecutor } from "./providers/anthropic";
import { BedrockExecutor } from "./providers/bedrock";
import { VertexExecutor } from "./providers/vertex";
import { CopilotExecutor } from "./providers/copilot";
import { GitLabDuoExecutor } from "./providers/gitlab_duo";
import { SnowflakeCortexExecutor } from "./providers/snowflake_cortex";

function register(
  name: string,
  ctor: new (opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
    auth?: Record<string, unknown>;
  }) => LLMExecutor,
): void {
  LLMExecutor.registerProvider({ name, ctor: ctor as never });
}

register("openrouter", OpenRouterExecutor);
register("openai", OpenAIExecutor);
register("mistral", MistralExecutor);
register("deepseek", DeepSeekExecutor);
register("groq", GroqExecutor);
register("cerebras", CerebrasExecutor);
register("fireworks", FireworksExecutor);
register("together", TogetherExecutor);
register("xai", XAIExecutor);
register("moonshot", MoonshotExecutor);
register("nvidia", NvidiaExecutor);
register("deepinfra", DeepInfraExecutor);
register("302ai", Ai302Executor);
register("digitalocean", DigitalOceanExecutor);
register("helicone", HeliconeExecutor);
register("scaleway", ScalewayExecutor);
register("venice", VeniceExecutor);
register("nebius", NebiusExecutor);
register("ovhcloud", OvhCloudExecutor);
register("stackit", StackitExecutor);
register("gmi", GmiExecutor);
register("zai", ZaiExecutor);
register("zenmux", ZenMuxExecutor);
register("minimax", MiniMaxExecutor);
register("minimax-cn", MiniMaxCnExecutor);
register("ionet", IoNetExecutor);
register("baseten", BasetenExecutor);
register("cortecs", CortecsExecutor);
register("huggingface", HuggingFaceExecutor);
register("lmstudio", LmStudioExecutor);
register("ollama", OllamaExecutor);
register("ollama-cloud", OllamaCloudExecutor);
register("llamacpp", LlamaCppExecutor);
register("vercel", VercelExecutor);
register("llmgateway", LlmGatewayExecutor);
register("cloudflare-gateway", CloudflareGatewayExecutor);
register("cloudflare-workers", CloudflareWorkersExecutor);
register("sap-aicore", SapAiCoreExecutor);
register("azure-openai", AzureOpenAIExecutor);
register("azure-cognitive", AzureCognitiveExecutor);
register("anthropic", AnthropicExecutor);
register("bedrock", BedrockExecutor);
register("vertex", VertexExecutor);
register("copilot", CopilotExecutor);
register("gitlab-duo", GitLabDuoExecutor);
register("snowflake-cortex", SnowflakeCortexExecutor);

// ponytail: lazy so bare `brainbox` (help/version) works without model config
let _llm: LLMExecutor | undefined;
export const llm: LLMExecutor = new Proxy({} as LLMExecutor, {
  get(_t, prop) {
    _llm ??= LLMExecutor.init();
    const v = Reflect.get(_llm, prop, _llm);
    return typeof v === "function"
      ? (v as (...a: unknown[]) => unknown).bind(_llm)
      : v;
  },
});
