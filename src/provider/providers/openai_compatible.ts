import { logger } from "@/utils/logger";
import {
  LLMExecutor,
  buildStructuredJsonRequest,
  defaultReasoningEffort,
  parseModelJson,
  parseStructuredJsonResult,
  stripThinkTags,
  resolveLlmCaller,
  logLlmWire,
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
  /**
   * When false, jsonMode uses a forced schema tool instead of response_format.
   * Hosts without OpenAI json_schema support (MiniMax, many local servers).
   */
  supportsResponseFormat?: boolean;
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
    finish_reason?: string;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  error?: { message?: string; type?: string };
  // MiniMax (and some CN hosts) return business errors here with HTTP 200.
  base_resp?: { status_code?: number; status_msg?: string };
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
  /** When false, jsonMode routes through a schema tool (no response_format). */
  protected readonly supportsResponseFormat: boolean;

  constructor(opts: OpenAICompatibleOptions) {
    super();
    this.providerName = opts.providerName;
    this.baseURL = opts.baseURL.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.defaultHeaders = opts.defaultHeaders ?? {};
    this.chatPath = opts.chatPath ?? "/chat/completions";
    this.noBearerPrefix = opts.noBearerPrefix ?? false;
    this.reasoningEffortInQuery = opts.reasoningEffortInQuery ?? false;
    this.supportsResponseFormat = opts.supportsResponseFormat ?? true;
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
    toolChoice?: { type: "tool"; name: string };
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
    if (opts.toolChoice) {
      body["tool_choice"] = {
        type: "function",
        function: { name: opts.toolChoice.name },
      };
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
    caller: string,
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
    const requestRaw = JSON.stringify(body);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: requestRaw,
    });
    const responseRaw = await res.text().catch(() => "");
    logLlmWire(caller, requestRaw, responseRaw);
    if (!res.ok) {
      log.error(
        `${this.providerName}: HTTP ${res.status} ${res.statusText} body=${responseRaw.slice(0, 500)}`,
      );
      throw new Error(
        `${this.providerName} request failed: ${res.status} ${res.statusText}`,
      );
    }
    let data: ChatResponse;
    try {
      data = JSON.parse(responseRaw) as ChatResponse;
    } catch {
      throw new Error(`${this.providerName}: invalid JSON response`);
    }
    if (data.error) {
      log.error(
        `${this.providerName}: API error ${data.error.type ?? ""} ${data.error.message ?? ""}`,
      );
      throw new Error(
        `${this.providerName} API error: ${data.error.message ?? "unknown"}`,
      );
    }
    // MiniMax returns business errors under base_resp with HTTP 200 and empty choices.
    const baseCode = data.base_resp?.status_code;
    if (typeof baseCode === "number" && baseCode !== 0) {
      const msg = data.base_resp?.status_msg?.trim() || `status_code ${baseCode}`;
      log.error(`${this.providerName}: base_resp ${baseCode} ${msg}`);
      throw new Error(`${this.providerName} API error: ${msg}`);
    }
    return data;
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    if ("jsonSchemaName" in options && !this.supportsResponseFormat) {
      return this.callJsonViaTool(model, options);
    }
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
    const data = await this.sendRequest(
      body,
      options.reasoningEffort,
      resolveLlmCaller(options),
    );
    const choice = data.choices?.[0];
    const raw = choice?.message?.content;
    const content = typeof raw === "string" ? stripThinkTags(raw) : raw;
    if (!content) {
      const finish = choice?.finish_reason ?? "no-choice";
      const reasoningLen =
        typeof choice?.message?.reasoning_content === "string"
          ? choice.message.reasoning_content.length
          : 0;
      log.debug(
        `call: empty content in choice 0 finish_reason=${finish} reasoning_len=${reasoningLen} rawType=${raw === null ? "null" : typeof raw}`,
      );
      throw new Error(
        reasoningLen > 0
          ? `Empty response from model (finish_reason=${finish}; reasoning present but no content)`
          : "Empty response from model",
      );
    }
    log.debug(`call: response ${content.length} chars`);
    return (jsonMode ? parseModelJson(content) : content) as T;
  }

  /** Schema-as-tool path for hosts without response_format/json_schema. */
  protected async callJsonViaTool<T>(
    model: string,
    options: CallOptions & {
      jsonSchemaName: string;
      jsonSchema: Record<string, unknown> | undefined;
    },
  ): Promise<T> {
    const { toolName, tool, instruction } = buildStructuredJsonRequest(options);
    log.debug(
      `callJsonViaTool: provider=${this.providerName} model=${model} tool=${toolName}`,
    );
    const choice = await this.chatWithTools(model, {
      caller: options.caller ?? options.jsonSchemaName,
      instruction,
      messages: [{ role: "user", content: options.message }],
      tools: [tool],
      reasoningEffort: "none",
      parallelToolCalls: false,
      toolChoice: { type: "tool", name: toolName },
    });
    return parseStructuredJsonResult(choice, toolName) as T;
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
      toolChoice: options.toolChoice,
    });
    const data = await this.sendRequest(
      body,
      options.reasoningEffort,
      resolveLlmCaller(options),
    );
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
