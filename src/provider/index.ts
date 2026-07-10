export {
  LLMExecutor,
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

LLMExecutor.registerProvider({
  name: "openrouter",
  ctor: OpenRouterExecutor,
});

export const llm = LLMExecutor.init();
