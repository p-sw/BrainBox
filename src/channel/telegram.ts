import { Bot } from "gramio";
import type { AvailabilityStatus } from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { BaseChannel } from "./base";
import type { BrainItemTelegram } from "@/brain/manager";
import { Brain } from "@/brain";

export class TelegramChannel extends BaseChannel<BrainItemTelegram> {
  private bot?: Bot;

  constructor(brain: Brain<BrainItemTelegram>) {
    super(brain);
  }

  async init(): Promise<void> {
    this.bot = new Bot(this.brain.brainbase.telegram.token);
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
