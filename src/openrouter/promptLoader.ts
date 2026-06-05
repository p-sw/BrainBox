import { readFile } from "fs/promises";
import path from "path";

const prompts = [
  "PERSONA_INIT",
  "PERSONA_BASE_SYSTEM_PROMPT",
  "DAILY_SCHEDULE",
  "MONTHLY_SCHEDULE",
  "SCHEDULE_AVAILABILITY",
] as const;
export type PromptKey = (typeof prompts)[number];

function fileName(promptKey: PromptKey): string {
  return promptKey.toLowerCase() + ".md";
}

const PROMPTS_DIR = path.resolve(import.meta.dir, "../../prompts");

export async function loadPrompt(promptKey: PromptKey): Promise<string> {
  const filePath = path.join(PROMPTS_DIR, fileName(promptKey));
  return readFile(filePath, "utf-8");
}
