import { Client, Events, GatewayIntentBits } from "discord.js";
import { z } from "zod";
import type { AvailabilityStatus } from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { BaseChannel } from "./base";

const discordConfigSchema = z.object({
  token: z.string().min(1),
});

export class DiscordChannel extends BaseChannel {
  private client?: Client;

  async init(): Promise<void> {
    const { token } = discordConfigSchema.parse({
      token: this.brain.brainbase.discord?.token,
    });
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.client.once(Events.ClientReady, (c) => {
      logger.success(`Discord ready as ${c.user.tag}`);
    });
    await this.client.login(token);
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
