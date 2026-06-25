import { readFile } from "fs/promises";
import path from "path";

const prompts = [
  "PERSONA_INIT",
  "PERSONA_BASE_SYSTEM_PROMPT",
  "PERSONA_BASE_SYSTEM_PROMPT_FIXED",
  "DAILY_SCHEDULE",
  "MONTHLY_SCHEDULE",
  "SCHEDULE_AVAILABILITY",
  "OBJECTIFIER",
  "SEND_MESSAGE",
  "START_CONVERSATION",
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
