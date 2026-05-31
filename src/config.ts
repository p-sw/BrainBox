import "dotenv/config";

export interface Config {
  openrouterApiKey: string;
}

const openrouterApiKey = process.env["OPENROUTER_API_KEY"];
if (!openrouterApiKey) throw new Error("OPENROUTER_API_KEY is missing");

export const config: Config = {
  openrouterApiKey: openrouterApiKey,
};
