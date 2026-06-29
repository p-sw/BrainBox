import { Client, Events, GatewayIntentBits } from "discord.js";
import type { AvailabilityStatus } from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { BaseChannel } from "./base";
import type { BrainItemDiscord } from "@/brain/manager";
import type { Brain } from "@/brain";

export class DiscordChannel extends BaseChannel<BrainItemDiscord> {
  private client?: Client;

  constructor(brain: Brain<BrainItemDiscord>) {
    super(brain);
  }

  async init(): Promise<void> {
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.client.once(Events.ClientReady, (c) => {
      logger.success(`Discord ready as ${c.user.tag}`);
    });
    await this.client.login(this.brain.brainbase.discord.token);
  }

  async send(_text: string, _opts?: { replyTo?: string }): Promise<void> {
    // ponytail: stub — wire up this.client.channels to send
    throw new Error("DiscordChannel.send not implemented");
  }

  async setAvailability(_status: AvailabilityStatus): Promise<void> {
    // ponytail: stub — wire up this.client.user.setPresence / setStatus
    throw new Error("DiscordChannel.setAvailability not implemented");
  }
}
