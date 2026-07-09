import { readFile } from "fs/promises";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "@/utils/logger";

const log = logger.child("prompt-loader");

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
  "MEMOIR",
] as const;
export type PromptKey = (typeof prompts)[number];

function fileName(promptKey: PromptKey): string {
  return promptKey.toLowerCase() + ".md";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = path.resolve(__dirname, "../../prompts");

export async function loadPrompt(promptKey: PromptKey): Promise<string> {
  const filePath = path.join(PROMPTS_DIR, fileName(promptKey));
  log.debug(`loadPrompt: ${promptKey} (${filePath})`);
  const content = await readFile(filePath, "utf-8");
  log.debug(`loadPrompt: ${promptKey} → ${content.length} chars`);
  return content;
}
