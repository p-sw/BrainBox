import {
  OpenAICompatibleExecutor,
  type OpenAICompatibleOptions,
} from "./openai_compatible";
import type { ReasoningEffort } from "../llm";

// MiniMax embeds CoT in content as <think>…</think> unless reasoning_split is
// on. OpenAI reasoning_effort is ignored; map it to MiniMax `thinking`.
// Pay-as-you-go and Token Plan (sk-cp-...) keys both work on these hosts.
class MiniMaxBase extends OpenAICompatibleExecutor {
  protected override buildBody(opts: {
    model: string;
    messages: Parameters<OpenAICompatibleExecutor["buildBody"]>[0]["messages"];
    responseFormat?: Record<string, unknown>;
    tools?: unknown[];
    parallelToolCalls?: boolean;
    reasoningEffort?: ReasoningEffort;
  }): Record<string, unknown> {
    const body = super.buildBody(opts);
    delete body["reasoning_effort"];
    body["reasoning_split"] = true;
    // M3 honors disabled; M2.x accepts it but keeps thinking on — split still
    // keeps final content clean either way.
    body["thinking"] =
      opts.reasoningEffort && opts.reasoningEffort !== "none"
        ? { type: "adaptive" }
        : { type: "disabled" };
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
