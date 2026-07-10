import { OpenAICompatibleExecutor } from "./openai_compatible";

export class CopilotExecutor extends OpenAICompatibleExecutor {
  constructor(opts: {
    apiKey: string;
    conversationModel: string;
    identityModel: string;
  }) {
    super({
      providerName: "copilot",
      baseURL: "https://api.githubcopilot.com",
      apiKey: opts.apiKey,
      conversationModel: opts.conversationModel,
      identityModel: opts.identityModel,
      defaultHeaders: {
        "Editor-Version": "vscode/1.85.1",
        "Editor-Plugin-Version": "copilot-chat/0.12.0",
        "Copilot-Integration-Id": "vscode-chat",
      },
    });
  }
}
