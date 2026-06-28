import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { parse as parseYaml } from "yaml";

export interface Config {
  openrouterApiKey: string;
  supermemoryApiKey: string;
  brainboxRoot: string;
}

const brainboxRoot = process.env["BRAINBOX_ROOT_PATH"]
  ? resolve(process.cwd(), process.env["BRAINBOX_ROOT_PATH"])
  : join(homedir(), ".brainbox");

interface BrainboxYaml {
  openrouter?: { apiKey?: string };
  supermemory?: { apiKey?: string };
}

const yamlPath = join(brainboxRoot, "brainbox.yaml");
let parsed: BrainboxYaml = {};
try {
  parsed = parseYaml(readFileSync(yamlPath, "utf8")) ?? {};
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    mkdirSync(dirname(yamlPath), { recursive: true });
    writeFileSync(
      yamlPath,
      "# Fill in your API keys, then run brainbox again.\n" +
        "openrouter:\n" +
        "  apiKey: \n" +
        "supermemory:\n" +
        "  apiKey: \n",
    );
  } else {
    throw err;
  }
}

const openrouterApiKey = parsed.openrouter?.apiKey;
if (!openrouterApiKey) throw new Error(`openrouter.apiKey is missing in ${yamlPath}`);

const supermemoryApiKey = parsed.supermemory?.apiKey;
if (!supermemoryApiKey) throw new Error(`supermemory.apiKey is missing in ${yamlPath}`);

export const config: Config = {
  openrouterApiKey,
  supermemoryApiKey,
  brainboxRoot,
};