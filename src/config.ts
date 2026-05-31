import "dotenv/config";

export interface Config {
  openrouterApiKey: string;
  dbPath: string;
}

const openrouterApiKey = process.env["OPENROUTER_API_KEY"];
if (!openrouterApiKey) throw new Error("OPENROUTER_API_KEY is missing");
const dbPath = process.env["DB_PATH"] ?? "sqlite.db";

export const config: Config = {
  openrouterApiKey,
  dbPath,
};
