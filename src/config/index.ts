import { brainboxRoot } from "./loader";
import { readRootFile } from "./file/root";
import { readAuthFile } from "./file/auth";

export interface Config {
  debug: boolean;
  brainboxRoot: string;
  supermemoryApiKey: string;
  conversationModel: string;
  identityModel: string;
  auth: Record<string, { apiKey: string; [k: string]: unknown }>;
}

// ponytail: live getters so same-process writes (onboard/model/auth) are visible
// to Brain.create / LLMExecutor.init instead of the empty import-time snapshot.
export const config: Config = {
  get debug() {
    return readRootFile().debug;
  },
  brainboxRoot,
  get supermemoryApiKey() {
    return readRootFile().supermemory.apiKey;
  },
  get conversationModel() {
    return readRootFile().conversationModel;
  },
  get identityModel() {
    return readRootFile().identityModel;
  },
  get auth() {
    return readAuthFile() as Config["auth"];
  },
};
