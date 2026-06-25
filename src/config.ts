import "dotenv/config";
import { join } from "path";

export interface Config {
  openrouterApiKey: string;
  supermemoryApiKey: string;
  brainboxRoot: string;
}

const openrouterApiKey = process.env["OPENROUTER_API_KEY"];
if (!openrouterApiKey) throw new Error("OPENROUTER_API_KEY is missing");

const supermemoryApiKey = process.env["SUPERMEMORY_API_KEY"];
if (!supermemoryApiKey) throw new Error("SUPERMEMORY_API_KEY is missing");

const brainboxRoot = join(
  process.cwd(),
  process.env["BRAINBOX_ROOT_PATH"] ?? "brainbox-data",
);

export const config: Config = {
  openrouterApiKey,
  supermemoryApiKey,
  brainboxRoot,
};
