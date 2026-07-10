import { config } from "@/config";
import { logger } from "@/utils/logger";

const log = logger.child("llm");

// --- Provider-agnostic shapes -----------------------------------------------

export type ChatAssistantMessage = {
  role: "assistant";
  content?: string;
  toolCalls?: ToolCall[];
};

export type ChatMessages =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | ChatAssistantMessage
  | { role: "tool"; content: string; toolCallId: string };

export type ToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

export type ChatFunctionTool = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type ChatChoice = {
  message: {
    content?: string;
    toolCalls?: ToolCall[];
  };
};

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type CallOptions = {
  instruction: string;
  message: string;
  reasoningEffort?: ReasoningEffort;
} & (
  | { jsonSchemaName: string; jsonSchema: Record<string, unknown> | undefined }
  | object
);

export type ChatWithToolsOptions = {
  instruction: string;
  messages: ChatMessages[];
  tools: ChatFunctionTool[];
  reasoningEffort?: ReasoningEffort;
  parallelToolCalls?: boolean;
};

// --- Abstract base ----------------------------------------------------------

export type ProviderCtor = new (opts: {
  apiKey: string;
  conversationModel: string;
  identityModel: string;
}) => LLMExecutor;

export abstract class LLMExecutor {
  abstract readonly providerName: string;
  abstract readonly models: { conversation: string; identity: string };

  abstract call<T>(model: string, options: CallOptions): Promise<T>;
  abstract chatWithTools(
    model: string,
    options: ChatWithToolsOptions,
  ): Promise<ChatChoice>;

  // ponytail: registry + factory. Adding a provider = one registerProvider call in index.ts.
  private static providers: Array<{ name: string; ctor: ProviderCtor }> = [];

  static registerProvider(p: { name: string; ctor: ProviderCtor }): void {
    LLMExecutor.providers.push(p);
  }

  private static lookup(name: string): ProviderCtor {
    const entry = LLMExecutor.providers.find((p) => p.name === name);
    if (!entry) {
      log.error(
        `init: unknown provider "${name}". Registered: ${LLMExecutor.providers.map((p) => p.name).join(", ") || "(none)"}`,
      );
      process.exit(1);
    }
    return entry.ctor;
  }

  static init(): LLMExecutor {
    const { conversationModel, identityModel, auth } = config;
    const parseSlot = (slot: string): { provider: string; model: string } => {
      const slash = slot.indexOf("/");
      if (slash < 0) {
        log.error(`init: model slot "${slot}" must be in "provider/model" form`);
        process.exit(1);
      }
      return { provider: slot.slice(0, slash), model: slot.slice(slash + 1) };
    };
    const conv = parseSlot(conversationModel);
    const id = parseSlot(identityModel);
    const build = (providerName: string): LLMExecutor => {
      const ctor = LLMExecutor.lookup(providerName);
      return new ctor({
        apiKey: auth[providerName]?.apiKey ?? "",
        conversationModel: conv.model,
        identityModel: id.model,
      });
    };

    if (conv.provider === id.provider) {
      return build(conv.provider);
    }

    const modelToProvider: Record<string, string> = {
      [conv.model]: conv.provider,
      [id.model]: id.provider,
    };
    const instances: Record<string, LLMExecutor> = {
      [conv.provider]: build(conv.provider),
      [id.provider]: build(id.provider),
    };
    const fallback = instances[conv.provider]!;

    return new (class extends LLMExecutor {
      readonly providerName = "dispatch";
      readonly models = {
        conversation: conv.model,
        identity: id.model,
      };
      call<T>(model: string, options: CallOptions): Promise<T> {
        const exec = instances[modelToProvider[model] ?? ""] ?? fallback;
        return exec.call<T>(model, options);
      }
      chatWithTools(model: string, options: ChatWithToolsOptions) {
        const exec = instances[modelToProvider[model] ?? ""] ?? fallback;
        return exec.chatWithTools(model, options);
      }
    })();
  }
}
