import { brainboxRoot } from "./loader";
import rootConfig from "./root";

export interface Config {
  openrouterApiKey: string;
  supermemoryApiKey: string;
  brainboxRoot: string;
}

export const config: Config = {
  brainboxRoot,
  openrouterApiKey: rootConfig.openrouter.apiKey,
  supermemoryApiKey: rootConfig.supermemory.apiKey,
};
