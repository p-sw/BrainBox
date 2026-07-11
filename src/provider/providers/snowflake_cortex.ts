import { logger } from "@/utils/logger";
import { z } from "zod";
import {
  LLMExecutor,
  defaultReasoningEffort,
  readAuthString,
  stripThinkTags,
  type CallOptions,
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ToolCall,
} from "../llm";

const CortexAuthSchema = z
  .object({
    account: z.string().optional(),
  })
  .loose();

type CortexTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type CortexMessageWire =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: unknown };
      }>;
    }
  | { role: "tool"; content: string; tool_call_id: string };

type CortexResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: unknown };
      }>;
    };
  }>;
  message?: string;
  error?: { message?: string };
};

function toCortexMessage(m: ChatMessages): CortexMessageWire {
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content ?? null,
      tool_calls: m.toolCalls?.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.function.name, arguments: c.function.arguments },
      })),
    };
  }
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  }
  return { role: m.role, content: m.content };
}

function toCortexTool(t: ChatFunctionTool): CortexTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? { type: "object", properties: {} },
    },
  };
}

export class SnowflakeCortexExecutor extends LLMExecutor {
  readonly providerName = "snowflake-cortex";
  readonly models: { conversation: string; identity: string };

  private readonly apiKey: string;
  private readonly baseURL: string;

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
    const parsed = CortexAuthSchema.safeParse(opts.auth ?? {});
    const extra = parsed.success ? parsed.data : {};
    const account =
      extra.account ??
      readAuthString(opts.auth, "account", "SNOWFLAKE_ACCOUNT") ??
      "";
    this.baseURL = account
      ? `https://${account}.snowflakecomputing.com/api/v2/cortex/inference:complete`
      : "https://__account__.snowflakecomputing.com/api/v2/cortex/inference:complete";
  }

  private async send(body: Record<string, unknown>): Promise<CortexResponse> {
    const res = await fetch(this.baseURL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `snowflake-cortex request failed: ${res.status} ${res.statusText} body=${text.slice(0, 500)}`,
      );
    }
    return (await res.json()) as CortexResponse;
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    const jsonMode = "jsonSchemaName" in options;
    const reasoning = defaultReasoningEffort(
      options.reasoningEffort,
      model,
      this.models.identity,
    );
    const log = logger.child("llm:snowflake-cortex");
    log.debug(
      `call: model=${model} jsonSchema=${jsonMode ? options.jsonSchemaName : "-"} msgLen=${options.message.length}`,
    );
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: options.instruction },
        { role: "user", content: options.message },
      ],
    };
    if (reasoning !== "none") {
      body["reasoning_effort"] = reasoning;
    }
    const data = await this.send(body);
    if (data.error) {
      throw new Error(
        `snowflake-cortex API error: ${data.error.message ?? "unknown"}`,
      );
    }
    const content = stripThinkTags(
      data.choices?.[0]?.message?.content ?? data.message ?? "",
    );
    if (!content) {
      throw new Error("Empty response from model");
    }
    return (jsonMode ? JSON.parse(content) : content) as T;
  }

  async chatWithTools(
    model: string,
    options: ChatWithToolsOptions,
  ): Promise<ChatChoice> {
    const log = logger.child("llm:snowflake-cortex");
    log.debug(
      `chatWithTools: model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: options.instruction },
        ...options.messages.map(toCortexMessage),
      ],
      tools: options.tools.map(toCortexTool),
    };
    const data = await this.send(body);
    if (data.error) {
      throw new Error(
        `snowflake-cortex API error: ${data.error.message ?? "unknown"}`,
      );
    }
    const choice = data.choices?.[0];
    const content = stripThinkTags(
      choice?.message?.content ?? data.message ?? "",
    );
    const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls?.map(
      (c) => ({
        id: c.id,
        function: {
          name: c.function.name,
          arguments:
            typeof c.function.arguments === "string"
              ? c.function.arguments
              : JSON.stringify(c.function.arguments ?? {}),
        },
      }),
    );
    return { message: { content: content || undefined, toolCalls } };
  }
}
