import {
  OpenAICompatibleExecutor,
  type OpenAICompatibleOptions,
} from "./openai_compatible";
import type { ReasoningEffort } from "../llm";

// MiniMax embeds CoT in content as <think>…</think> unless reasoning_split is
// on. OpenAI reasoning_effort is ignored; map it to MiniMax `thinking`.
// Pay-as-you-go and Token Plan (sk-cp-...) keys both work on these hosts.
//
// Gotchas that produce our "Empty response from model" error:
// - No max_completion_tokens: thinking can consume the whole (low) default
//   budget and leave content as "" / "\n".
// - response_format / parallel_tool_calls are not in MiniMax's OpenAPI schema;
//   unknown fields are rejected or return base_resp errors with empty content.
// - jsonMode + adaptive thinking often yields whitespace-only final content.
class MiniMaxBase extends OpenAICompatibleExecutor {
  protected override buildBody(opts: {
    model: string;
    messages: Parameters<OpenAICompatibleExecutor["buildBody"]>[0]["messages"];
    responseFormat?: Record<string, unknown>;
    tools?: unknown[];
    parallelToolCalls?: boolean;
    reasoningEffort?: ReasoningEffort;
  }): Record<string, unknown> {
    const jsonMode = opts.responseFormat !== undefined;
    const body = super.buildBody(opts);
    delete body["reasoning_effort"];
    // Not supported on MiniMax chat completions — drop before send.
    delete body["response_format"];
    delete body["parallel_tool_calls"];
    body["reasoning_split"] = true;
    // Room for thinking + final answer. MiniMax docs recommend large caps;
    // without an explicit limit, short defaults empty `content` after CoT.
    body["max_completion_tokens"] = 16384;
    // M3 honors disabled; M2.x accepts it but keeps thinking on — split still
    // keeps final content clean either way. Skip thinking for structured JSON
    // so the model spends budget on the actual payload.
    const wantThink =
      !jsonMode &&
      opts.reasoningEffort !== undefined &&
      opts.reasoningEffort !== "none";
    body["thinking"] = wantThink ? { type: "adaptive" } : { type: "disabled" };
    return body;
  }
}

function minimaxOpts(
  providerName: string,
  baseURL: string,
  opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  },
): OpenAICompatibleOptions {
  return {
    providerName,
    baseURL,
    apiKey: opts.apiKey,
    conversationModel: opts.conversationModel,
    identityModel: opts.identityModel,
  };
}

export class MiniMaxExecutor extends MiniMaxBase {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super(minimaxOpts("minimax", "https://api.minimax.io/v1", opts));
  }
}

export class MiniMaxCnExecutor extends MiniMaxBase {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super(minimaxOpts("minimax-cn", "https://api.minimaxi.com/v1", opts));
  }
}
