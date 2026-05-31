import { config } from "@/config";
import { OpenRouter } from "@openrouter/sdk";
import type { ChatRequestEffort } from "@openrouter/sdk/models";

const CONVERSATION_MODEL = "x-ai/grok-4.3" as const;
const IDENTITY_MODEL = "openai/gpt-5.4-mini" as const;
type MODELS = typeof CONVERSATION_MODEL | typeof IDENTITY_MODEL;

interface StructuredOptions {
  instruction: string;
  message: string;
  reasoningEffort: ChatRequestEffort;
  jsonSchemaName: string;
  jsonSchema:
    | {
        [k: string]: any;
      }
    | undefined;
}

export class LLMExecutor {
  private apiKey: string;
  client: OpenRouter;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new OpenRouter({ apiKey: this.apiKey, appTitle: "boxbrain" });
  }

  private structuredCall<T>(model: MODELS, options: StructuredOptions) {
    this.client.chat.send({
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
          effort: options.reasoningEffort,
        },
        responseFormat: {
          type: "json_schema",
          jsonSchema: {
            name: options.jsonSchemaName,
            schema: options.jsonSchema,
            strict: true,
          },
        },
        stream: false,
      },
    });
  }
}

export const llm = new LLMExecutor(config.openrouterApiKey);
