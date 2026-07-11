import { logger } from "@/utils/logger";
import { z } from "zod";
import {
  LLMExecutor,
  parseModelJson,
  readAuthString,
  stripThinkTags,
  type CallOptions,
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ToolCall,
} from "../llm";

const GitLabAuthSchema = z
  .object({
    baseURL: z.string().optional(),
  })
  .loose();

type MessageWire =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; content: string; tool_call_id: string };

type DuoResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  error?: { message?: string };
};

function toMessage(m: ChatMessages): MessageWire {
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

function toTool(t: ChatFunctionTool) {
  return {
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.parameters ?? {},
    },
  };
}

export class GitLabDuoExecutor extends LLMExecutor {
  readonly providerName = "gitlab-duo";
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
    const parsed = GitLabAuthSchema.safeParse(opts.auth ?? {});
    const extra = parsed.success ? parsed.data : {};
    this.baseURL = (
      extra.baseURL ??
      readAuthString(opts.auth, "baseURL", "GITLAB_BASE_URL") ??
      "https://gitlab.com/api/v4/ai/llm/proxy"
    ).replace(/\/+$/, "");
  }

  private async send(body: Record<string, unknown>): Promise<DuoResponse> {
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
        `gitlab-duo request failed: ${res.status} ${res.statusText} body=${text.slice(0, 500)}`,
      );
    }
    return (await res.json()) as DuoResponse;
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    const jsonMode = "jsonSchemaName" in options;
    const log = logger.child("llm:gitlab-duo");
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
    const data = await this.send(body);
    if (data.error) {
      throw new Error(
        `gitlab-duo API error: ${data.error.message ?? "unknown"}`,
      );
    }
    const content = stripThinkTags(data.choices?.[0]?.message?.content ?? "");
    if (!content) {
      throw new Error("Empty response from model");
    }
    return (jsonMode ? parseModelJson(content) : content) as T;
  }

  async chatWithTools(
    model: string,
    options: ChatWithToolsOptions,
  ): Promise<ChatChoice> {
    const log = logger.child("llm:gitlab-duo");
    log.debug(
      `chatWithTools: model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: options.instruction },
        ...options.messages.map(toMessage),
      ],
      tools: options.tools.map(toTool),
    };
    const data = await this.send(body);
    if (data.error) {
      throw new Error(
        `gitlab-duo API error: ${data.error.message ?? "unknown"}`,
      );
    }
    const choice = data.choices?.[0];
    const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls?.map(
      (c) => ({
        id: c.id,
        function: { name: c.function.name, arguments: c.function.arguments },
      }),
    );
    return {
      message: {
        content: choice?.message?.content
          ? stripThinkTags(choice.message.content)
          : undefined,
        toolCalls,
      },
    };
  }
}
