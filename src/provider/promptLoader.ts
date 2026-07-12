import { logger } from "@/utils/logger";

import dailySchedule from "../../prompts/daily_schedule.md" with { type: "text" };
import memoir from "../../prompts/memoir.md" with { type: "text" };
import monthlySchedule from "../../prompts/monthly_schedule.md" with { type: "text" };
import objectifier from "../../prompts/objectifier.md" with { type: "text" };
import personaBaseSystemPrompt from "../../prompts/persona_base_system_prompt.md" with {
  type: "text",
};
import personaBaseSystemPromptFixed from "../../prompts/persona_base_system_prompt_fixed.md" with {
  type: "text",
};
import personaInit from "../../prompts/persona_init.md" with { type: "text" };
import scheduleAvailability from "../../prompts/schedule_availability.md" with {
  type: "text",
};
import sendMessage from "../../prompts/send_message.md" with { type: "text" };
import startConversation from "../../prompts/start_conversation.md" with {
  type: "text",
};

const log = logger.child("prompt-loader");

const prompts = {
  PERSONA_INIT: personaInit,
  PERSONA_BASE_SYSTEM_PROMPT: personaBaseSystemPrompt,
  PERSONA_BASE_SYSTEM_PROMPT_FIXED: personaBaseSystemPromptFixed,
  DAILY_SCHEDULE: dailySchedule,
  MONTHLY_SCHEDULE: monthlySchedule,
  SCHEDULE_AVAILABILITY: scheduleAvailability,
  OBJECTIFIER: objectifier,
  SEND_MESSAGE: sendMessage,
  START_CONVERSATION: startConversation,
  MEMOIR: memoir,
} as const;

export type PromptKey = keyof typeof prompts;

export async function loadPrompt(promptKey: PromptKey): Promise<string> {
  const content = prompts[promptKey];
  log.debug(`loadPrompt: ${promptKey} → ${content.length} chars`);
  return content;
}
