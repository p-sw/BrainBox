import {
  Client,
  Events,
  GatewayIntentBits,
  type SendableChannels,
} from "discord.js";
import type { AvailabilityStatus } from "@/provider/schema";
import { logger } from "@/utils/logger";
import { BaseChannel, type PairingEntry, type PairingInbound } from "./base";
import type { BrainItemDiscord } from "@/brain/manager";
import type { Brain } from "@/brain";

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
      logger.debug(
        `DiscordChannel.init: pre-bound channelId=${this.brain.brainbase.discord.channelId}`,
      );
    } else {
      this.engagePairing();
      logger.debug(`DiscordChannel.init: entering pairing mode`);
    }
    this.registerActive();
    this.client.once(Events.ClientReady, (c) => {
      logger.success(`Discord ready as ${c.user.tag}`);
      const channelId = this.brain.brainbase.discord.channelId;
      if (channelId && !this.targetChannel) {
        logger.debug(`DiscordClientReady: resolving configured channel ${channelId}`);
        void this.resolveConfiguredChannel(channelId);
      }
      void this.initAvailability();
    });
    this.client.on(Events.MessageCreate, (msg) => {
      if (msg.author.bot) return;
      const content = msg.content;
      if (!content) return;
      const channelId = this.brain.brainbase.discord.channelId;
      if (channelId !== undefined && msg.channelId !== channelId) {
        logger.debug(
          `MessageCreate: ignoring from channel=${msg.channelId} (not bound)`,
        );
        return;
      }
      const inbound: PairingInbound = {
        content,
        time: msg.createdAt,
        replyTo: msg.id,
        channelId: msg.channelId,
      };
      if (channelId === undefined) {
        logger.debug(`MessageCreate: routing to pairing (no channelId bound)`);
        void this.onPairing(inbound);
        return;
      }
      logger.debug(
        `MessageCreate: dispatching (channel=${msg.channelId})`,
      );
      void this.onMessage({
        sender: "user",
        time: msg.createdAt,
        content,
      });
    });
    logger.debug(`DiscordChannel.init: logging in`);
    await this.client.login(this.brain.brainbase.discord.token);
  }

  protected async sendPairingReply(
    text: string,
    inbound: PairingInbound,
  ): Promise<void> {
    if (!this.client || inbound.channelId === undefined) {
      logger.debug(`sendPairingReply: no client or channelId, skip`);
      return;
    }
    const channel = await this.client.channels.fetch(inbound.channelId);
    if (!channel || !channel.isSendable()) {
      logger.debug(
        `sendPairingReply: channel ${inbound.channelId} not sendable`,
      );
      return;
    }
    logger.debug(`sendPairingReply: posting to ${inbound.channelId}`);
    await channel.send({
      content: text,
      ...(inbound.replyTo
        ? { reply: { messageReference: inbound.replyTo } }
        : {}),
    });
  }

  protected override async completePairing(entry: PairingEntry): Promise<void> {
    if (entry.channelId !== undefined) {
      this.brain.brainbase.discord.channelId = entry.channelId;
      await this.brain.persistBrainBase();
      this.targetChannel = undefined;
      if (this.client) {
        const channel = await this.client.channels.fetch(entry.channelId);
        if (channel && channel.isSendable()) {
          this.targetChannel = channel;
        }
      }
      logger.success(
        `Discord channel bound: ${this.brain.brainbase.displayName} → ${entry.channelId}`,
      );
    }
    await super.completePairing(entry);
  }

  async send(text: string, opts?: { replyTo?: string }): Promise<void> {
    const channel = await this.resolveSendChannel();
    if (!channel) {
      throw new Error(
        "DiscordChannel.send: no channel yet (no inbound message)",
      );
    }
    logger.debug(
      `send: posting ${text.length} chars${opts?.replyTo ? ` (reply to ${opts.replyTo})` : ""}`,
    );
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
    if (!this.client?.user) {
      logger.debug(`setAvailability: no client/user, skip`);
      return;
    }
    const mapped = AVAILABILITY_STATUS_MAP[status];
    logger.debug(`setAvailability: ${status} → ${mapped}`);
    this.client.user.setStatus(mapped);
  }

  private async resolveSendChannel(): Promise<SendableChannels | undefined> {
    if (this.targetChannel) {
      logger.debug(`resolveSendChannel: cache hit`);
      return this.targetChannel;
    }
    if (!this.client?.isReady()) {
      logger.debug(`resolveSendChannel: client not ready, returning undefined`);
      return undefined;
    }
    const channelId = this.brain.brainbase.discord.channelId;
    if (!channelId) {
      logger.debug(`resolveSendChannel: no channelId bound`);
      return undefined;
    }
    logger.debug(`resolveSendChannel: fetching ${channelId}`);
    const channel = await this.client.channels.fetch(channelId);
    if (channel && channel.isSendable()) {
      this.targetChannel = channel;
      logger.debug(`resolveSendChannel: cached`);
    } else {
      logger.debug(`resolveSendChannel: ${channelId} not sendable`);
    }
    return this.targetChannel;
  }

  private async resolveConfiguredChannel(channelId: string): Promise<void> {
    if (!this.client) {
      logger.debug(`resolveConfiguredChannel: no client`);
      return;
    }
    logger.debug(`resolveConfiguredChannel: fetching ${channelId}`);
    const channel = await this.client.channels.fetch(channelId);
    if (channel && channel.isSendable()) {
      this.targetChannel = channel;
      logger.debug(`resolveConfiguredChannel: cached`);
    } else {
      logger.debug(`resolveConfiguredChannel: ${channelId} not sendable`);
    }
  }

  protected async teardownClient(): Promise<void> {
    logger.debug(`teardownClient: destroying discord client`);
    this.client?.destroy();
    this.client = undefined;
    this.targetChannel = undefined;
  }
}
