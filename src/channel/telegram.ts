import { Bot } from "gramio";
import { z } from "zod";
import type { AvailabilityStatus } from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { BaseChannel } from "./base";

const telegramConfigSchema = z.object({
  token: z.string().min(1),
});

export class TelegramChannel extends BaseChannel {
  private bot?: Bot;

  async init(): Promise<void> {
    const { token } = telegramConfigSchema.parse({
      token: this.brain.brainbase.telegram?.token,
    });
    this.bot = new Bot(token);
    this.bot.onStart(({ info }) => {
      logger.success(`Telegram ready as @${info.username}`);
    });
    await this.bot.start();
  }

  async send(_text: string, _opts?: { replyTo?: string }): Promise<void> {
    // ponytail: stub — wire up this.bot.api.sendMessage
    throw new Error("TelegramChannel.send not implemented");
  }

  async setAvailability(_status: AvailabilityStatus): Promise<void> {
    // ponytail: stub — Telegram has no presence concept; map to custom status or no-op
    throw new Error("TelegramChannel.setAvailability not implemented");
  }
}
