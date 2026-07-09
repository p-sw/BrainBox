import { brainboxRoot } from "./loader";
import rootConfig from "./loaded/root";

export interface Config {
  debug: boolean;
  openrouterApiKey: string;
  supermemoryApiKey: string;
  brainboxRoot: string;
}

export const config: Config = {
  debug: rootConfig.debug,
  brainboxRoot,
  openrouterApiKey: rootConfig.openrouter.apiKey,
  supermemoryApiKey: rootConfig.supermemory.apiKey,
};
