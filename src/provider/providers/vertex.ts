import { logger } from "@/utils/logger";
import { z } from "zod";
import {
  LLMExecutor,
  defaultReasoningEffort,
  readAuthString,
  type CallOptions,
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ToolCall,
} from "../llm";

const VertexAuthSchema = z
  .object({
    project: z.string().optional(),
    region: z.string().optional(),
  })
  .loose();

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[]; role?: string };
    finishReason?: string;
  }>;
  error?: { message?: string; code?: number };
};

function toGeminiContents(
  messages: ChatMessages[],
): Array<{ role: string; parts: GeminiPart[] }> {
  const out: Array<{ role: string; parts: GeminiPart[] }> = [];
  for (const m of messages) {
    if (m.role === "system") continue; // system goes into systemInstruction
    if (m.role === "user") {
      out.push({ role: "user", parts: [{ text: m.content }] });
      continue;
    }
    if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.toolCalls) {
        for (const c of m.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
          } catch {
            args = {};
          }
          parts.push({ functionCall: { name: c.function.name, args } });
        }
      }
      out.push({ role: "model", parts });
      continue;
    }
    if (m.role === "tool") {
      let response: Record<string, unknown> = {};
      try {
        response = JSON.parse(m.content);
      } catch {
        response = { result: m.content };
      }
      // ponytail: We don't track the original tool name on tool messages; the
      // caller names the response. The wire response uses an empty name.
      out.push({
        role: "user",
        parts: [{ functionResponse: { name: "", response } }],
      });
    }
  }
  return out;
}

function toGeminiTool(t: ChatFunctionTool) {
  return {
    functionDeclarations: [
      {
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? { type: "object", properties: {} },
      },
    ],
  };
}

function extractFromGemini(data: GeminiResponse): {
  text: string;
  toolCalls: ToolCall[] | undefined;
} {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  let idx = 0;
  for (const p of parts) {
    if ("text" in p) text += p.text;
    if ("functionCall" in p) {
      toolCalls.push({
        id: `call_${idx++}`,
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args ?? {}),
        },
      });
    }
  }
  return { text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

export class VertexExecutor extends LLMExecutor {
  readonly providerName = "vertex";
  readonly models: { conversation: string; identity: string };

  private readonly apiKey: string;
  private readonly project: string;
  private readonly region: string;
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
    const parsed = VertexAuthSchema.safeParse(opts.auth ?? {});
    const extra = parsed.success ? parsed.data : {};
    this.project =
      extra.project ??
      readAuthString(opts.auth, "project", "GOOGLE_CLOUD_PROJECT") ??
      "";
    this.region =
      extra.region ??
      readAuthString(opts.auth, "region", "GOOGLE_CLOUD_REGION") ??
      "us-central1";
    this.baseURL = this.project
      ? `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.region}/publishers/google/models`
      : "https://us-central1-aiplatform.googleapis.com/v1";
  }

  private async generate(
    model: string,
    body: Record<string, unknown>,
  ): Promise<GeminiResponse> {
    const url = `${this.baseURL}/${encodeURIComponent(model)}:generateContent`;
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
        `vertex request failed: ${res.status} ${res.statusText} body=${text.slice(0, 500)}`,
      );
    }
    return (await res.json()) as GeminiResponse;
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    const jsonMode = "jsonSchemaName" in options;
    const log = logger.child("llm:vertex");
    log.debug(
      `call: model=${model} jsonSchema=${jsonMode ? options.jsonSchemaName : "-"} msgLen=${options.message.length}`,
    );
    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: options.message }],
        },
      ],
      systemInstruction: { parts: [{ text: options.instruction }] },
    };
    if (jsonMode) {
      body["generationConfig"] = {
        responseMimeType: "application/json",
        responseSchema: options.jsonSchema,
      };
    }
    const data = await this.generate(model, body);
    if (data.error) {
      throw new Error(`vertex API error: ${data.error.message ?? "unknown"}`);
    }
    const { text } = extractFromGemini(data);
    if (!text) {
      throw new Error("Empty response from model");
    }
    return (jsonMode ? JSON.parse(text) : text) as T;
  }

  async chatWithTools(
    model: string,
    options: ChatWithToolsOptions,
  ): Promise<ChatChoice> {
    const log = logger.child("llm:vertex");
    log.debug(
      `chatWithTools: model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    const contents = toGeminiContents(options.messages);
    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: options.instruction }] },
      tools:
        options.tools.length > 0
          ? [toGeminiTool(options.tools[0]!)]
          : undefined,
    };
    const data = await this.generate(model, body);
    if (data.error) {
      throw new Error(`vertex API error: ${data.error.message ?? "unknown"}`);
    }
    const { text, toolCalls } = extractFromGemini(data);
    return { message: { content: text || undefined, toolCalls } };
  }
}
