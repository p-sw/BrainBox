import { config } from "@/config";
import { OpenRouter } from "@openrouter/sdk";
import { logger } from "@/utils/logger";
import type {
  ChatAssistantMessage,
  ChatChoice,
  ChatFunctionTool,
  ChatMessages,
  ChatRequestEffort,
} from "@openrouter/sdk/models";

const log = logger.child("llm");

const CONVERSATION_MODEL = "x-ai/grok-4.3" as const;
const IDENTITY_MODEL = "openai/gpt-5.4-mini" as const;
type MODELS = typeof CONVERSATION_MODEL | typeof IDENTITY_MODEL;

type StructuredOptions = {
  instruction: string;
  message: string;
  reasoningEffort?: ChatRequestEffort;
} & (
  | {
      jsonSchemaName: string;
      jsonSchema:
        | {
            [k: string]: any;
          }
        | undefined;
    }
  | {}
);

type ChatWithToolsOptions = {
  instruction: string;
  messages: ChatMessages[];
  tools: ChatFunctionTool[];
  reasoningEffort?: ChatRequestEffort;
  parallelToolCalls?: boolean;
};

export class LLMExecutor {
  models = {
    conversation: CONVERSATION_MODEL,
    identity: IDENTITY_MODEL,
  };

  private apiKey: string;
  client: OpenRouter;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new OpenRouter({ apiKey: this.apiKey, appTitle: "boxbrain" });
  }

  async call<T>(model: MODELS, options: StructuredOptions) {
    const jsonMode = "jsonSchemaName" in options;
    log.debug(
      `llm.call: model=${model} jsonSchema=${jsonMode ? options.jsonSchemaName : "-"} msgLen=${options.message.length}`,
    );
    const result = await this.client.chat.send({
      chatRequest: {
        model,
        messages: [
          {
            role: "system",
            content: options.instruction,
          },
          {
            role: "user",
            content: options.message,
          },
        ],
        reasoning: {
          effort:
            options.reasoningEffort ??
            (model === IDENTITY_MODEL ? "medium" : "none"),
        },
        responseFormat:
          "jsonSchemaName" in options
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
      log.debug(`llm.call: empty content in choice 0`);
      throw new Error("Empty response from model");
    }
    log.debug(`llm.call: response ${content.length} chars`);

    if ("jsonSchemaName" in options) {
      return JSON.parse(content) as T;
    } else {
      return content as T;
    }
  }

  async chatWithTools(
    model: MODELS,
    options: ChatWithToolsOptions,
  ): Promise<ChatChoice> {
    log.debug(
      `llm.chatWithTools: model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    const result = await this.client.chat.send({
      chatRequest: {
        model,
        messages: [
          {
            role: "system",
            content: options.instruction,
          },
          ...options.messages,
        ],
        reasoning: {
          effort:
            options.reasoningEffort ??
            (model === IDENTITY_MODEL ? "medium" : "none"),
        },
        responseFormat: { type: "text" },
        tools: options.tools,
        parallelToolCalls: options.parallelToolCalls ?? false,
        stream: false,
      },
    });

    const choice = result.choices[0];
    if (!choice) {
      log.debug(`llm.chatWithTools: no choice in response`);
      throw new Error("LLM returned no choice");
    }
    const calls = choice.message.toolCalls?.length ?? 0;
    const textLen =
      typeof choice.message.content === "string"
        ? choice.message.content.length
        : 0;
    log.debug(`llm.chatWithTools: choice toolCalls=${calls} text=${textLen}`);
    return choice;
  }
}

export type {
  ChatAssistantMessage,
  ChatChoice,
  ChatFunctionTool,
  ChatMessages,
};

export const llm = new LLMExecutor(config.openrouterApiKey);
