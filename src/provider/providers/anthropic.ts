import { logger } from "@/utils/logger";
import { z } from "zod";
import {
  LLMExecutor,
  defaultReasoningEffort,
  parseModelJson,
  readAuthString,
  stripThinkTags,
  type CallOptions,
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ReasoningEffort,
  type ToolCall,
} from "../llm";

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  error?: { message?: string; type?: string };
};

const REASONING_BUDGET: Record<Exclude<ReasoningEffort, "none">, number> = {
  low: 1024,
  medium: 4096,
  high: 16384,
};

const AnthropicAuthSchema = z
  .object({
    baseURL: z.string().optional(),
    apiVersion: z.string().optional(),
  })
  .loose();

function toAnthropicMessages(messages: ChatMessages[]): {
  system?: string;
  msgs: Array<Record<string, unknown>>;
} {
  let system: string | undefined;
  const msgs: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") {
      system = (system ? system + "\n\n" : "") + m.content;
      continue;
    }
    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      if (m.toolCalls) {
        for (const c of m.toolCalls) {
          let input: unknown = {};
          try {
            input = c.function.arguments
              ? JSON.parse(c.function.arguments)
              : {};
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: c.id,
            name: c.function.name,
            input,
          });
        }
      }
      msgs.push({ role: "assistant", content: blocks });
      continue;
    }
    if (m.role === "tool") {
      msgs.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId,
            content: m.content,
          },
        ],
      });
    }
  }
  return { system, msgs };
}

function toAnthropicTool(t: ChatFunctionTool): AnthropicTool {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.parameters ?? { type: "object", properties: {} },
  };
}

export class AnthropicExecutor extends LLMExecutor {
  readonly providerName = "anthropic";
  readonly models: { conversation: string; identity: string };

  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly apiVersion: string;

  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
    auth?: Record<string, unknown>;
  }) {
    super();
    this.models = {
      conversation: opts.conversationModel,
      identity: opts.identityModel,
    };
    this.apiKey = opts.apiKey;
    const parsed = AnthropicAuthSchema.safeParse(opts.auth ?? {});
    const extra = parsed.success ? parsed.data : {};
    this.baseURL = (
      extra.baseURL ??
      readAuthString(opts.auth, "baseURL", "ANTHROPIC_BASE_URL") ??
      "https://api.anthropic.com"
    ).replace(/\/v1\/?$/, "");
    this.apiVersion = extra.apiVersion ?? "2023-06-01";
  }

  private async send(
    body: Record<string, unknown>,
  ): Promise<AnthropicResponse> {
    const res = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `anthropic request failed: ${res.status} ${res.statusText} body=${text.slice(0, 500)}`,
      );
    }
    return (await res.json()) as AnthropicResponse;
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    const jsonMode = "jsonSchemaName" in options;
    const reasoning = defaultReasoningEffort(
      options.reasoningEffort,
      model,
      this.models.identity,
    );
    const log = logger.child("llm:anthropic");
    log.debug(
      `call: model=${model} jsonSchema=${jsonMode ? options.jsonSchemaName : "-"} msgLen=${options.message.length}`,
    );
    const outputCap = 4096;
    const body: Record<string, unknown> = {
      model,
      max_tokens: outputCap,
      system: options.instruction,
      messages: [{ role: "user", content: options.message }],
    };
    if (reasoning !== "none") {
      const budget = REASONING_BUDGET[reasoning];
      // Anthropic requires budget_tokens < max_tokens
      body["max_tokens"] = budget + outputCap;
      body["thinking"] = {
        type: "enabled",
        budget_tokens: budget,
      };
    }
    const data = await this.send(body);
    if (data.error) {
      throw new Error(
        `anthropic API error: ${data.error.message ?? "unknown"}`,
      );
    }
    const text = stripThinkTags(
      (data.content ?? [])
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join(""),
    );
    if (!text) {
      throw new Error("Empty response from model");
    }
    return (jsonMode ? parseModelJson(text) : text) as T;
  }

  async chatWithTools(
    model: string,
    options: ChatWithToolsOptions,
  ): Promise<ChatChoice> {
    const reasoning = defaultReasoningEffort(
      options.reasoningEffort,
      model,
      this.models.identity,
    );
    const log = logger.child("llm:anthropic");
    log.debug(
      `chatWithTools: model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    const { system, msgs } = toAnthropicMessages(options.messages);
    const outputCap = 4096;
    const body: Record<string, unknown> = {
      model,
      max_tokens: outputCap,
      system: system ?? options.instruction,
      messages: msgs,
      tools: options.tools.map(toAnthropicTool),
    };
    if (reasoning !== "none") {
      const budget = REASONING_BUDGET[reasoning];
      body["max_tokens"] = budget + outputCap;
      body["thinking"] = {
        type: "enabled",
        budget_tokens: budget,
      };
    }
    const data = await this.send(body);
    if (data.error) {
      throw new Error(
        `anthropic API error: ${data.error.message ?? "unknown"}`,
      );
    }
    const blocks = data.content ?? [];
    const text = stripThinkTags(
      blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join(""),
    );
    const toolCalls: ToolCall[] | undefined = blocks
      .filter(
        (
          b,
        ): b is {
          type: "tool_use";
          id: string;
          name: string;
          input: unknown;
        } => b.type === "tool_use",
      )
      .map((b) => ({
        id: b.id,
        function: {
          name: b.name,
          arguments:
            typeof b.input === "string" ? b.input : JSON.stringify(b.input),
        },
      }));
    return { message: { content: text || undefined, toolCalls } };
  }
}
