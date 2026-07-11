import { logger } from "@/utils/logger";
import {
  LLMExecutor,
  defaultReasoningEffort,
  parseModelJson,
  stripThinkTags,
  type CallOptions,
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ReasoningEffort,
  type ToolCall,
} from "../llm";

const log = logger.child("llm:openai-compatible");

// ponytail: Most LLM providers expose an OpenAI-compatible /v1/chat/completions endpoint.
// One executor, parameterized by baseURL + auth headers, covers the majority of the list.
// Per-provider tweaks live in subclass overrides; default behavior needs none.

export type OpenAICompatibleOptions = {
  baseURL: string;
  apiKey: string;
  conversationModel: string;
  identityModel: string;
  defaultHeaders?: Record<string, string>;
  chatPath?: string;
  noBearerPrefix?: boolean;
  reasoningEffortInQuery?: boolean;
  providerName: string;
};

type ChatMessageWire =
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

type ChatResponse = {
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
  error?: { message?: string; type?: string };
};

function toWireMessage(m: ChatMessages): ChatMessageWire {
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

function fromChoice(
  choice: NonNullable<ChatResponse["choices"]>[number],
): ChatChoice {
  const msg = choice.message ?? {};
  const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map((c) => ({
    id: c.id,
    function: { name: c.function.name, arguments: c.function.arguments },
  }));
  return {
    message: {
      content:
        typeof msg.content === "string"
          ? stripThinkTags(msg.content)
          : undefined,
      toolCalls,
    },
  };
}

function toWireTool(t: ChatFunctionTool) {
  return {
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.parameters ?? {},
    },
  };
}

function buildResponseFormat(
  jsonSchemaName: string,
  jsonSchema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: jsonSchemaName,
      schema: jsonSchema ?? {},
      strict: true,
    },
  };
}

export class OpenAICompatibleExecutor extends LLMExecutor {
  readonly providerName: string;
  readonly models: { conversation: string; identity: string };

  protected readonly baseURL: string;
  protected readonly apiKey: string;
  protected readonly defaultHeaders: Record<string, string>;
  protected readonly chatPath: string;
  protected readonly noBearerPrefix: boolean;
  protected readonly reasoningEffortInQuery: boolean;

  constructor(opts: OpenAICompatibleOptions) {
    super();
    this.providerName = opts.providerName;
    this.baseURL = opts.baseURL.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.defaultHeaders = opts.defaultHeaders ?? {};
    this.chatPath = opts.chatPath ?? "/chat/completions";
    this.noBearerPrefix = opts.noBearerPrefix ?? false;
    this.reasoningEffortInQuery = opts.reasoningEffortInQuery ?? false;
    this.models = {
      conversation: opts.conversationModel,
      identity: opts.identityModel,
    };
  }

  protected buildBody(opts: {
    model: string;
    messages: ChatMessageWire[];
    responseFormat?: Record<string, unknown>;
    tools?: unknown[];
    parallelToolCalls?: boolean;
    reasoningEffort?: ReasoningEffort;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      stream: false,
    };
    if (opts.responseFormat) body["response_format"] = opts.responseFormat;
    if (opts.tools) body["tools"] = opts.tools;
    if (opts.parallelToolCalls !== undefined) {
      body["parallel_tool_calls"] = opts.parallelToolCalls;
    }
    if (opts.reasoningEffort && opts.reasoningEffort !== "none") {
      body["reasoning_effort"] = opts.reasoningEffort;
    }
    return body;
  }

  protected buildRequestUrl(
    _model: string,
    reasoningEffort: ReasoningEffort | undefined,
  ): string {
    const url = new URL(this.baseURL + this.chatPath);
    if (
      this.reasoningEffortInQuery &&
      reasoningEffort &&
      reasoningEffort !== "none"
    ) {
      url.searchParams.set("reasoning_effort", reasoningEffort);
    }
    return url.toString();
  }

  private async sendRequest(
    body: Record<string, unknown>,
    reasoningEffort: ReasoningEffort | undefined,
  ): Promise<ChatResponse> {
    const modelName = body["model"];
    const modelStr = typeof modelName === "string" ? modelName : "";
    const url = this.buildRequestUrl(modelStr, reasoningEffort);
    const authHeader: Record<string, string> = this.apiKey
      ? this.noBearerPrefix
        ? { Authorization: this.apiKey }
        : { Authorization: `Bearer ${this.apiKey}` }
      : {};
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...authHeader,
      ...this.defaultHeaders,
    };
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.error(
        `${this.providerName}: HTTP ${res.status} ${res.statusText} body=${text.slice(0, 500)}`,
      );
      throw new Error(
        `${this.providerName} request failed: ${res.status} ${res.statusText}`,
      );
    }
    const data = (await res.json()) as ChatResponse;
    if (data.error) {
      log.error(
        `${this.providerName}: API error ${data.error.type ?? ""} ${data.error.message ?? ""}`,
      );
      throw new Error(
        `${this.providerName} API error: ${data.error.message ?? "unknown"}`,
      );
    }
    return data;
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    const jsonMode = "jsonSchemaName" in options;
    const reasoning = defaultReasoningEffort(
      options.reasoningEffort,
      model,
      this.models.identity,
    );
    log.debug(
      `call: provider=${this.providerName} model=${model} jsonSchema=${jsonMode ? options.jsonSchemaName : "-"} msgLen=${options.message.length}`,
    );
    const body = this.buildBody({
      model,
      messages: [
        { role: "system", content: options.instruction },
        { role: "user", content: options.message },
      ],
      responseFormat: jsonMode
        ? buildResponseFormat(options.jsonSchemaName, options.jsonSchema)
        : undefined,
      reasoningEffort: reasoning,
    });
    const data = await this.sendRequest(body, options.reasoningEffort);
    const raw = data.choices?.[0]?.message?.content;
    const content = typeof raw === "string" ? stripThinkTags(raw) : raw;
    if (!content) {
      log.debug(`call: empty content in choice 0`);
      throw new Error("Empty response from model");
    }
    log.debug(`call: response ${content.length} chars`);
    return (jsonMode ? parseModelJson(content) : content) as T;
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
    log.debug(
      `chatWithTools: provider=${this.providerName} model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    const body = this.buildBody({
      model,
      messages: [
        { role: "system", content: options.instruction },
        ...options.messages.map(toWireMessage),
      ],
      tools: options.tools.map(toWireTool),
      parallelToolCalls: options.parallelToolCalls ?? false,
      reasoningEffort: reasoning,
    });
    const data = await this.sendRequest(body, options.reasoningEffort);
    const choice = data.choices?.[0];
    if (!choice) {
      log.debug(`chatWithTools: no choice in response`);
      throw new Error("LLM returned no choice");
    }
    const calls = choice.message?.tool_calls?.length ?? 0;
    const textLen =
      typeof choice.message?.content === "string"
        ? choice.message.content.length
        : 0;
    log.debug(`chatWithTools: choice toolCalls=${calls} text=${textLen}`);
    return fromChoice(choice);
  }
}
