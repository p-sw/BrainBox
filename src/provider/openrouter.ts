import { OpenRouter } from "@openrouter/sdk";
import { logger } from "@/utils/logger";
import type {
  ChatChoice as OrChoice,
  ChatFunctionTool as OrTool,
  ChatMessages as OrMessage,
  ChatRequestEffort,
} from "@openrouter/sdk/models";
import {
  LLMExecutor,
  type CallOptions,
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ReasoningEffort,
  type ToolCall,
} from "./llm";

const log = logger.child("llm:openrouter");

const REASONING_EFFORT_MAP: Record<ReasoningEffort, ChatRequestEffort> = {
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
};

function toOrMessage(m: ChatMessages): OrMessage {
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content ?? "",
      toolCalls: m.toolCalls?.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.function.name, arguments: c.function.arguments },
      })),
    };
  }
  if (m.role === "tool") {
    return { role: "tool", content: m.content, toolCallId: m.toolCallId };
  }
  return { role: m.role, content: m.content };
}

function fromOrChoice(choice: OrChoice): ChatChoice {
  const msg = choice.message;
  const toolCalls: ToolCall[] | undefined = msg.toolCalls?.map((c) => ({
    id: c.id,
    function: { name: c.function.name, arguments: c.function.arguments },
  }));
  return {
    message: {
      content: typeof msg.content === "string" ? msg.content : undefined,
      toolCalls,
    },
  };
}

function toOrTool(t: ChatFunctionTool): OrTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.parameters ?? {},
    },
  };
}

export class OpenRouterExecutor extends LLMExecutor {
  readonly providerName = "openrouter";
  readonly models: { conversation: string; identity: string };

  private client: OpenRouter;

  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super();
    this.client = new OpenRouter({ apiKey: opts.apiKey, appTitle: "boxbrain" });
    this.models = {
      conversation: opts.conversationModel,
      identity: opts.identityModel,
    };
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    const jsonMode = "jsonSchemaName" in options;
    log.debug(
      `call: model=${model} jsonSchema=${jsonMode ? options.jsonSchemaName : "-"} msgLen=${options.message.length}`,
    );
    const result = await this.client.chat.send({
      chatRequest: {
        model,
        messages: [
          { role: "system", content: options.instruction },
          { role: "user", content: options.message },
        ],
        reasoning: {
          effort:
            options.reasoningEffort ??
            (model === this.models.identity
              ? REASONING_EFFORT_MAP.medium
              : REASONING_EFFORT_MAP.none),
        },
        responseFormat: jsonMode
          ? {
              type: "json_schema",
              jsonSchema: {
                name: options.jsonSchemaName,
                schema: options.jsonSchema,
                strict: true,
              },
            }
          : { type: "text" },
        stream: false,
      },
    });

    const content = result.choices[0]?.message?.content;
    if (!content) {
      log.debug(`call: empty content in choice 0`);
      throw new Error("Empty response from model");
    }
    log.debug(`call: response ${content.length} chars`);

    return (jsonMode ? JSON.parse(content) : content) as T;
  }

  async chatWithTools(
    model: string,
    options: ChatWithToolsOptions,
  ): Promise<ChatChoice> {
    log.debug(
      `chatWithTools: model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    const result = await this.client.chat.send({
      chatRequest: {
        model,
        messages: [
          { role: "system", content: options.instruction },
          ...options.messages.map(toOrMessage),
        ],
        reasoning: {
          effort:
            options.reasoningEffort ??
            (model === this.models.identity
              ? REASONING_EFFORT_MAP.medium
              : REASONING_EFFORT_MAP.none),
        },
        responseFormat: { type: "text" },
        tools: options.tools.map(toOrTool),
        parallelToolCalls: options.parallelToolCalls ?? false,
        stream: false,
      },
    });

    const choice = result.choices[0];
    if (!choice) {
      log.debug(`chatWithTools: no choice in response`);
      throw new Error("LLM returned no choice");
    }
    const calls = choice.message.toolCalls?.length ?? 0;
    const textLen =
      typeof choice.message.content === "string"
        ? choice.message.content.length
        : 0;
    log.debug(`chatWithTools: choice toolCalls=${calls} text=${textLen}`);
    return fromOrChoice(choice);
  }
}
