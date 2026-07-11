import { logger } from "@/utils/logger";
import {
  LLMExecutor,
  defaultReasoningEffort,
  readAuthString,
  stripThinkTags,
  type CallOptions,
  type ChatChoice,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ToolCall,
} from "../llm";

type ChatMessageWire =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "tool"; content: string; tool_call_id: string };

type CloudflareResponse = {
  result?: {
    response?: string;
    tool_calls?: Array<{
      name?: string;
      arguments?: unknown;
    }>;
  };
  errors?: Array<{ message: string }>;
  success?: boolean;
};

function toCloudflareMessage(m: ChatMessages): ChatMessageWire {
  if (m.role === "assistant") {
    return { role: "assistant", content: m.content ?? "" };
  }
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  }
  return { role: m.role, content: m.content };
}

export class CloudflareWorkersExecutor extends LLMExecutor {
  readonly providerName = "cloudflare-workers";
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
    const accountId = readAuthString(
      opts.auth,
      "accountId",
      "CLOUDFLARE_ACCOUNT_ID",
    );
    this.baseURL = accountId
      ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`
      : "https://api.cloudflare.com/client/v4/accounts/__cf_account_id__/ai/run";
  }

  private async run(
    model: string,
    body: Record<string, unknown>,
  ): Promise<CloudflareResponse> {
    const url = `${this.baseURL}/${encodeURIComponent(model)}`;
    const res = await fetch(url, {
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
        `cloudflare-workers request failed: ${res.status} ${res.statusText} body=${text.slice(0, 500)}`,
      );
    }
    return (await res.json()) as CloudflareResponse;
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    const jsonMode = "jsonSchemaName" in options;
    const reasoning = defaultReasoningEffort(
      options.reasoningEffort,
      model,
      this.models.identity,
    );
    const log = logger.child("llm:cloudflare-workers");
    log.debug(
      `call: model=${model} jsonSchema=${jsonMode ? options.jsonSchemaName : "-"} msgLen=${options.message.length}`,
    );
    const messages: ChatMessageWire[] = [
      { role: "system", content: options.instruction },
      { role: "user", content: options.message },
    ];
    const body: Record<string, unknown> = { messages };
    if (jsonMode) {
      body["response_format"] = {
        type: "json_schema",
        schema: options.jsonSchema,
      };
    }
    if (reasoning !== "none") {
      body["reasoning_effort"] = reasoning;
    }
    const data = await this.run(model, body);
    if (data.errors && data.errors.length > 0) {
      throw new Error(
        `cloudflare-workers API error: ${data.errors.map((e) => e.message).join("; ")}`,
      );
    }
    const content = stripThinkTags(data.result?.response ?? "");
    if (!content) {
      throw new Error("Empty response from model");
    }
    return (jsonMode ? JSON.parse(content) : content) as T;
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
    const log = logger.child("llm:cloudflare-workers");
    log.debug(
      `chatWithTools: model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    const messages: ChatMessageWire[] = [
      { role: "system", content: options.instruction },
      ...options.messages.map(toCloudflareMessage),
    ];
    const body: Record<string, unknown> = {
      messages,
      tools: options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };
    if (reasoning !== "none") {
      body["reasoning_effort"] = reasoning;
    }
    const data = await this.run(model, body);
    if (data.errors && data.errors.length > 0) {
      throw new Error(
        `cloudflare-workers API error: ${data.errors.map((e) => e.message).join("; ")}`,
      );
    }
    const content = stripThinkTags(data.result?.response ?? "");
    const toolCalls: ToolCall[] | undefined = data.result?.tool_calls?.map(
      (c, idx) => ({
        id: `call_${idx}`,
        function: {
          name: c.name ?? "",
          arguments:
            typeof c.arguments === "string"
              ? c.arguments
              : JSON.stringify(c.arguments ?? {}),
        },
      }),
    );
    return { message: { content: content || undefined, toolCalls } };
  }
}
