import { config } from "@/config";
import { OpenRouter } from "@openrouter/sdk";
import type { ChatRequestEffort } from "@openrouter/sdk/models";

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
      throw new Error("Empty response from model");
    }

    if ("jsonSchemaName" in options) {
      return JSON.parse(content) as T;
    } else {
      return content as T;
    }
  }
}

export const llm = new LLMExecutor(config.openrouterApiKey);
