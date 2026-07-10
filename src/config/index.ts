import { brainboxRoot } from "./loader";
import rootConfig from "./loaded/root";
import authConfig from "./loaded/auth";

export interface Config {
  debug: boolean;
  brainboxRoot: string;
  supermemoryApiKey: string;
  conversationModel: string;
  identityModel: string;
  auth: Record<string, { apiKey: string; [k: string]: unknown }>;
}

export const config: Config = {
  debug: rootConfig.debug,
  brainboxRoot,
  supermemoryApiKey: rootConfig.supermemory.apiKey,
  conversationModel: rootConfig.conversationModel,
  identityModel: rootConfig.identityModel,
  auth: authConfig as Config["auth"],
};
