import {
  Client,
  Events,
  GatewayIntentBits,
  type SendableChannels,
} from "discord.js";
import type { AvailabilityStatus } from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { BaseChannel } from "./base";
import type { BrainItemDiscord } from "@/brain/manager";
import type { Brain } from "@/brain";
import type { MessageHistoryEntry } from "@/brain/messageHistory";

const HISTORY_CAP = 1000;
const AVAILABILITY_STATUS_MAP: Record<
  AvailabilityStatus,
  "online" | "dnd" | "invisible"
> = {
  online: "online",
  "do-not-disturb": "dnd",
  offline: "invisible",
};

export class DiscordChannel extends BaseChannel<BrainItemDiscord> {
  private client?: Client;
  private targetChannel?: SendableChannels;
  private history: MessageHistoryEntry[] = [];

  constructor(brain: Brain<BrainItemDiscord>) {
    super(brain);
  }

  async init(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent, // ponytail: privileged intent — required for msg.content; disable if unavailable, text will be empty
      ],
    });
    if (this.brain.brainbase.discord.channelId) {
      this.isReady = true;
    }
    this.client.once(Events.ClientReady, (c) => {
      logger.success(`Discord ready as ${c.user.tag}`);
      const channelId = this.brain.brainbase.discord.channelId;
      if (channelId && !this.targetChannel) {
        void this.resolveConfiguredChannel(channelId);
      }
    });
    this.client.on(Events.MessageCreate, (msg) => {
      if (msg.author.bot) return;
      const content = msg.content;
      if (!content) return;
      const configuredChannelId = this.brain.brainbase.discord.channelId;
      if (
        configuredChannelId !== undefined &&
        msg.channelId !== configuredChannelId
      ) {
        return;
      }
      if (configuredChannelId === undefined) {
        this.brain.brainbase.discord.channelId = msg.channelId;
        void this.brain.persistBrainBase();
        this.isReady = true;
      }
      if (!this.targetChannel && msg.channel.isSendable()) {
        this.targetChannel = msg.channel;
      }
      const entry: MessageHistoryEntry = {
        sender: "user",
        time: msg.createdAt,
        content,
      };
      this.pushHistory(entry);
      void this.onMessage(entry);
    });
    await this.client.login(this.brain.brainbase.discord.token);
  }

  async send(text: string, opts?: { replyTo?: string }): Promise<void> {
    const channel = await this.resolveSendChannel();
    if (!channel) {
      throw new Error(
        "DiscordChannel.send: no channel yet (no inbound message)",
      );
    }
    if (opts?.replyTo) {
      await channel.send({
        content: text,
        reply: { messageReference: opts.replyTo },
      });
    } else {
      await channel.send(text);
    }
  }

  async setAvailability(status: AvailabilityStatus): Promise<void> {
    if (!this.client?.user) return;
    this.client.user.setStatus(AVAILABILITY_STATUS_MAP[status]);
  }

  async getMessageHistoryBetween(
    start: Date,
    end: Date,
  ): Promise<ReadonlyArray<MessageHistoryEntry>> {
    return this.history.filter((m) => m.time >= start && m.time <= end);
  }

  private pushHistory(entry: MessageHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > HISTORY_CAP) this.history.shift();
  }

  private async resolveSendChannel(): Promise<SendableChannels | undefined> {
    if (this.targetChannel) return this.targetChannel;
    if (!this.client?.isReady()) return undefined;
    const channelId = this.brain.brainbase.discord.channelId;
    if (!channelId) return undefined;
    const channel = await this.client.channels.fetch(channelId);
    if (channel && channel.isSendable()) {
      this.targetChannel = channel;
    }
    return this.targetChannel;
  }

  private async resolveConfiguredChannel(channelId: string): Promise<void> {
    if (!this.client) return;
    const channel = await this.client.channels.fetch(channelId);
    if (channel && channel.isSendable()) {
      this.targetChannel = channel;
    }
  }
}
