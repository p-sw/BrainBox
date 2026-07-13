import { logger } from "@/utils/logger";
import { createHmac, createHash } from "node:crypto";
import {
  LLMExecutor,
  buildStructuredJsonRequest,
  parseStructuredJsonResult,
  readAuthString,
  stripThinkTags,
  resolveLlmCaller,
  logLlmWire,
  type CallOptions,
  type ChatChoice,
  type ChatFunctionTool,
  type ChatMessages,
  type ChatWithToolsOptions,
  type ToolCall,
} from "../llm";

type BedrockBody = {
  anthropic_version: string;
  max_tokens: number;
  system?: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: { type: string; name?: string };
};

type BedrockResponse = Record<string, unknown>;

const pad2 = (n: number): string => n.toString().padStart(2, "0");

function amzDate(now: Date): { date: string; datetime: string } {
  return {
    date: `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`,
    datetime:
      `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T` +
      `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`,
  };
}

function signRequest(opts: {
  method: string;
  host: string;
  path: string;
  body: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
}): Record<string, string> {
  const now = new Date();
  const { date, datetime } = amzDate(now);
  const payloadHash = createHash("sha256")
    .update(opts.body, "utf8")
    .digest("hex");

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${opts.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${datetime}\n` +
    (opts.sessionToken ? `x-amz-security-token:${opts.sessionToken}\n` : "");
  const signedHeaders =
    `content-type;host;x-amz-content-sha256;x-amz-date` +
    (opts.sessionToken ? `;x-amz-security-token` : "");

  const canonicalRequest = [
    opts.method,
    opts.path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${date}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  // AWS SigV4 key derivation: four rounds of HMAC-SHA256 with a layered key.
  const kDate = createHmac("sha256", `AWS4${opts.secretKey}`)
    .update(date, "utf8")
    .digest();
  const kRegion = createHmac("sha256", kDate)
    .update(opts.region, "utf8")
    .digest();
  const kService = createHmac("sha256", kRegion)
    .update(opts.service, "utf8")
    .digest();
  const kSigning = createHmac("sha256", kService)
    .update("aws4_request", "utf8")
    .digest();
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const auth = `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers: Record<string, string> = {
    Authorization: auth,
    "Content-Type": "application/json",
    "X-Amz-Date": datetime,
    "X-Amz-Content-Sha256": payloadHash,
  };
  if (opts.sessionToken) headers["X-Amz-Security-Token"] = opts.sessionToken;
  return headers;
}

function toAnthropicMessages(messages: ChatMessages[]): {
  system?: string;
  msgs: Array<Record<string, unknown>>;
} {
  let system: string | undefined;
  const msgs: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") {
      system = (system ? system + "\n\n" : "") + m.content;
      continue;
    }
    if (m.role === "user") {
      msgs.push({ role: "user", content: [{ type: "text", text: m.content }] });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      if (m.toolCalls) {
        for (const c of m.toolCalls) {
          let input: unknown = {};
          try {
            input = c.function.arguments
              ? JSON.parse(c.function.arguments)
              : {};
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: c.id,
            name: c.function.name,
            input,
          });
        }
      }
      msgs.push({ role: "assistant", content: blocks });
      continue;
    }
    if (m.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: [{ type: "text", text: m.content }],
      };
      const last = msgs[msgs.length - 1];
      if (
        last &&
        last["role"] === "user" &&
        Array.isArray(last["content"]) &&
        (last["content"] as Array<{ type?: string }>)[0]?.type === "tool_result"
      ) {
        (last["content"] as unknown[]).push(block);
      } else {
        msgs.push({ role: "user", content: [block] });
      }
    }
  }
  return { system, msgs };
}

function toAnthropicTool(t: ChatFunctionTool) {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.parameters ?? { type: "object", properties: {} },
  };
}

function extractAnthropicContent(data: BedrockResponse): {
  text: string;
  toolCalls: ToolCall[] | undefined;
} {
  const content = (data["content"] as Array<Record<string, unknown>>) ?? [];
  const text = stripThinkTags(
    content
      .filter((b) => b["type"] === "text")
      .map((b) => b["text"] as string)
      .join(""),
  );
  const toolCalls: ToolCall[] | undefined = content
    .filter((b) => b["type"] === "tool_use")
    .map((b) => ({
      id: b["id"] as string,
      function: {
        name: b["name"] as string,
        arguments:
          typeof b["input"] === "string"
            ? b["input"]
            : JSON.stringify(b["input"] ?? {}),
      },
    }));
  return { text, toolCalls };
}

export class BedrockExecutor extends LLMExecutor {
  readonly providerName = "bedrock";
  readonly models: { conversation: string; identity: string };

  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly region: string;
  private readonly baseURL: string;
  private readonly sessionToken: string;

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
    const colon = opts.apiKey.indexOf(":");
    this.accessKeyId = colon >= 0 ? opts.apiKey.slice(0, colon) : opts.apiKey;
    this.secretAccessKey =
      colon >= 0
        ? opts.apiKey.slice(colon + 1)
        : readAuthString(opts.auth, "secretAccessKey", "AWS_SECRET_ACCESS_KEY");
    this.region =
      readAuthString(opts.auth, "region", "AWS_REGION") || "us-east-1";
    this.sessionToken = readAuthString(
      opts.auth,
      "sessionToken",
      "AWS_SESSION_TOKEN",
    );
    this.baseURL = `https://bedrock-runtime.${this.region}.amazonaws.com`;
  }

  private async invoke(
    model: string,
    body: BedrockBody,
    caller: string,
  ): Promise<BedrockResponse> {
    const bodyStr = JSON.stringify(body);
    const path = `/model/${encodeURIComponent(model)}/invoke`;
    const headers = signRequest({
      method: "POST",
      host: `bedrock-runtime.${this.region}.amazonaws.com`,
      path,
      body: bodyStr,
      region: this.region,
      service: "bedrock",
      accessKey: this.accessKeyId,
      secretKey: this.secretAccessKey,
      sessionToken: this.sessionToken || undefined,
    });
    const res = await fetch(this.baseURL + path, {
      method: "POST",
      headers,
      body: bodyStr,
    });
    const responseRaw = await res.text().catch(() => "");
    logLlmWire(caller, bodyStr, responseRaw);
    if (!res.ok) {
      throw new Error(
        `bedrock request failed: ${res.status} ${res.statusText} body=${responseRaw.slice(0, 500)}`,
      );
    }
    return JSON.parse(responseRaw) as BedrockResponse;
  }

  async call<T>(model: string, options: CallOptions): Promise<T> {
    const log = logger.child("llm:bedrock");
    if ("jsonSchemaName" in options) {
      log.debug(
        `call: model=${model} jsonSchema=${options.jsonSchemaName} via tool`,
      );
      const { toolName, tool, instruction } = buildStructuredJsonRequest({
        instruction: options.instruction,
        jsonSchemaName: options.jsonSchemaName,
        jsonSchema: options.jsonSchema,
      });
      const choice = await this.chatWithTools(model, {
        caller: options.caller ?? options.jsonSchemaName,
        instruction,
        messages: [{ role: "user", content: options.message }],
        tools: [tool],
        toolChoice: { type: "tool", name: toolName },
      });
      return parseStructuredJsonResult(choice, toolName) as T;
    }
    log.debug(`call: model=${model} jsonSchema=- msgLen=${options.message.length}`);
    if (!model.startsWith("anthropic.") && !model.startsWith("us.anthropic.")) {
      throw new Error(
        `bedrock provider currently only supports Anthropic models (got ${model})`,
      );
    }
    const body: BedrockBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      system: options.instruction,
      messages: [{ role: "user", content: options.message }],
    };
    const data = await this.invoke(model, body, resolveLlmCaller(options));
    const { text } = extractAnthropicContent(data);
    if (!text) {
      throw new Error("Empty response from model");
    }
    return text as T;
  }

  async chatWithTools(
    model: string,
    options: ChatWithToolsOptions,
  ): Promise<ChatChoice> {
    const log = logger.child("llm:bedrock");
    log.debug(
      `chatWithTools: model=${model} msgs=${options.messages.length} tools=${options.tools.length}`,
    );
    if (!model.startsWith("anthropic.") && !model.startsWith("us.anthropic.")) {
      throw new Error(
        `bedrock provider currently only supports Anthropic models (got ${model})`,
      );
    }
    const body: BedrockBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      system: system ?? options.instruction,
      messages: msgs,
      tools: options.tools.map(toAnthropicTool),
    };
    if (options.toolChoice) {
      body.tool_choice = {
        type: "tool",
        name: options.toolChoice.name,
      };
    }
    const data = await this.invoke(model, body, resolveLlmCaller(options));
    const { text, toolCalls } = extractAnthropicContent(data);
    return { message: { content: text || undefined, toolCalls } };
  }
}
