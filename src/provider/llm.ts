import { config } from "@/config";
import { logger, isLlmLogEnabled, writeLlmExchange } from "@/utils/logger";

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
  /** Log file label: `YYYY-MM-DD-hh-mm-ss-<caller>.log` */
  caller?: string;
  reasoningEffort?: ReasoningEffort;
} & (
  | { jsonSchemaName: string; jsonSchema: Record<string, unknown> | undefined }
  | object
);

export type ChatWithToolsOptions = {
  instruction: string;
  messages: ChatMessages[];
  tools: ChatFunctionTool[];
  /** Log file label: `YYYY-MM-DD-hh-mm-ss-<caller>.log` */
  caller?: string;
  reasoningEffort?: ReasoningEffort;
  parallelToolCalls?: boolean;
  /**
   * Force a specific tool when the host supports tool_choice
   * (Anthropic `{type:"tool",name}`, OpenAI-style function).
   */
  toolChoice?: { type: "tool"; name: string };
};

// --- Abstract base ----------------------------------------------------------

export type ProviderCtor = new (opts: {
  apiKey: string;
  conversationModel: string;
  identityModel: string;
  // ponytail: per-provider knobs (region, project, deployment, endpoint) come
  // from the auth record and are forwarded as-is. Concrete providers read the
  // fields they need; new providers don't require editing this signature.
  auth?: Record<string, unknown>;
}) => LLMExecutor;

export function defaultReasoningEffort(
  effort: ReasoningEffort | undefined,
  model: string,
  identityModel: string,
): ReasoningEffort {
  if (effort) return effort;
  return model === identityModel ? "medium" : "none";
}

// Some models embed CoT as <think>…</think> inside content. Strip before
// JSON.parse / persona text so structured calls don't choke on the wrapper.
export function stripThinkTags(content: string): string {
  return content.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").trim();
}

// jsonMode helper: strip think tags, unwrap common model wrappers
// (``` fences, double-encoded JSON strings, prose-around-JSON), then parse.
export function parseModelJson(content: string): unknown {
  const cleaned = stripThinkTags(content);
  const candidates: string[] = [cleaned];
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const extracted = extractJsonSlice(cleaned);
  if (extracted) candidates.push(extracted);

  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      return decodeJsonValue(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to parse model JSON");
}

function decodeJsonValue(text: string): unknown {
  let value: unknown = JSON.parse(text);
  // Models sometimes return a JSON string that itself holds JSON:
  // "\"{\\\"a\\\":1}\"" or "{\"a\":1}" as a quoted string value.
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    const inner = value.trim();
    if (
      !(
        (inner.startsWith("{") && inner.endsWith("}")) ||
        (inner.startsWith("[") && inner.endsWith("]")) ||
        (inner.startsWith('"') && inner.endsWith('"'))
      )
    ) {
      break;
    }
    value = JSON.parse(inner);
  }
  return value;
}

// First balanced {...} or [...] slice, string-aware. Handles prose wrappers.
function extractJsonSlice(text: string): string | undefined {
  const start = text.search(/[\{\[]/);
  if (start < 0) return undefined;
  const open = text[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Sanitize a schema name into a function-tool identifier. */
export function schemaToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  return cleaned.length > 0 ? cleaned : "submit_result";
}

/**
 * Build a single-tool request that forces structured output for hosts without
 * response_format / json_schema. The tool's parameters ARE the schema.
 */
export function buildStructuredJsonRequest(options: {
  instruction: string;
  jsonSchemaName: string;
  jsonSchema: Record<string, unknown> | undefined;
}): {
  toolName: string;
  tool: ChatFunctionTool;
  instruction: string;
} {
  const toolName = schemaToolName(options.jsonSchemaName);
  return {
    toolName,
    tool: {
      name: toolName,
      description: `Submit the structured ${options.jsonSchemaName} result.`,
      parameters: options.jsonSchema ?? {
        type: "object",
        additionalProperties: true,
      },
    },
    instruction: `${options.instruction}

You MUST call the \`${toolName}\` tool exactly once with the complete answer.
Do not write the JSON as plain text or inside a markdown code fence.`,
  };
}

/** Prefer tool-call arguments; fall back to content + loose parse. */
export function parseStructuredJsonResult(
  choice: ChatChoice,
  toolName: string,
): unknown {
  const call =
    choice.message.toolCalls?.find((c) => c.function.name === toolName) ??
    choice.message.toolCalls?.[0];
  if (call?.function.arguments) {
    return parseModelJson(call.function.arguments);
  }
  if (choice.message.content) {
    return parseModelJson(choice.message.content);
  }
  throw new Error("Empty response from model");
}

export function readAuthString(
  auth: Record<string, unknown> | undefined,
  key: string,
  envName?: string,
): string {
  const fromAuth =
    typeof auth?.[key] === "string" ? (auth[key] as string) : undefined;
  if (fromAuth) return fromAuth;
  if (envName) {
    const fromEnv = process.env[envName];
    if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  }
  return "";
}

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

  static listProviderNames(): string[] {
    return LLMExecutor.providers.map((p) => p.name);
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
        log.error(
          `init: model slot "${slot}" must be in "provider/model" form`,
        );
        process.exit(1);
      }
      return { provider: slot.slice(0, slash), model: slot.slice(slash + 1) };
    };
    const conv = parseSlot(conversationModel);
    const id = parseSlot(identityModel);
    const build = (providerName: string): LLMExecutor => {
      const ctor = LLMExecutor.lookup(providerName);
      const providerAuth = (auth[providerName] ?? {}) as Record<
        string,
        unknown
      >;
      return new ctor({
        apiKey: (providerAuth["apiKey"] as string) ?? "",
        conversationModel: conv.model,
        identityModel: id.model,
        auth: providerAuth,
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

/** Label for logs/llm files. */
export function resolveLlmCaller(
  options: { caller?: string; jsonSchemaName?: string },
  fallback = "llm",
): string {
  return options.caller ?? options.jsonSchemaName ?? fallback;
}

/**
 * Log bare request/response bytes right after the provider round-trip —
 * no pretty-print, no stripThinkTags, no JSON parse of model content.
 */
export function logLlmWire(
  caller: string,
  request: string,
  response: string,
): void {
  if (!isLlmLogEnabled()) return;
  writeLlmExchange(
    caller,
    `======== REQUEST ========\n${request}\n\n======== RESPONSE ========\n${response}\n`,
  );
}


// ponytail: thin wrapper so callers can `import { listProviderNames }`
// without going through the class — static class members aren't a top-level
// binding under `verbatimModuleSyntax`.
export function listProviderNames(): string[] {
  return LLMExecutor.listProviderNames();
}