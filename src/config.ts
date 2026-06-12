import "dotenv/config";
import { join } from "path";

export interface Config {
  openrouterApiKey: string;
  supermemoryApiKey: string;
  braindbPath: string;
}

const openrouterApiKey = process.env["OPENROUTER_API_KEY"];
if (!openrouterApiKey) throw new Error("OPENROUTER_API_KEY is missing");

const supermemoryApiKey = process.env["SUPERMEMORY_API_KEY"];
if (!supermemoryApiKey) throw new Error("SUPERMEMORY_API_KEY is missing");

const braindbPath = join(
  process.cwd(),
  process.env["BRAINDB_PATH"] ?? "brainbox.json",
);

export const config: Config = {
  openrouterApiKey,
  supermemoryApiKey,
  braindbPath,
};
