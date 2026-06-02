import "dotenv/config";
import { join } from "path";

export interface Config {
  openrouterApiKey: string;
  dbPath: string;
  braindbPath: string;
}

const openrouterApiKey = process.env["OPENROUTER_API_KEY"];
if (!openrouterApiKey) throw new Error("OPENROUTER_API_KEY is missing");
const dbPath = join(process.cwd(), process.env["DB_PATH"] ?? "brainbox.db");
const braindbPath = join(
  process.cwd(),
  process.env["BRAINDB_PATH"] ?? "brainbox.json",
);

export const config: Config = {
  openrouterApiKey,
  dbPath,
  braindbPath,
};
