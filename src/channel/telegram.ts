import { Bot } from "gramio";
import type { AvailabilityStatus } from "@/provider/schema";
import { logger } from "@/utils/logger";
import { BaseChannel, type PairingInbound, type PairingEntry } from "./base";
import type { BrainItemTelegram } from "@/brain/manager";
import type { Brain } from "@/brain";

export class TelegramChannel extends BaseChannel<BrainItemTelegram> {
  private bot?: Bot;
  private chatId?: number;

  constructor(brain: Brain<BrainItemTelegram>) {
    super(brain);
  }

  async init(): Promise<void> {
    this.bot = new Bot(this.brain.brainbase.telegram.token);
    this.chatId = this.brain.brainbase.telegram.chatId;
    if (this.chatId !== undefined) {
      this.isReady = true;
      logger.debug(
        `TelegramChannel.init: pre-bound chatId=${this.chatId}`,
      );
    } else {
      this.engagePairing();
      logger.debug(`TelegramChannel.init: entering pairing mode`);
    }
    this.registerActive();
    this.bot.onStart(({ info }) => {
      logger.success(`Telegram ready as @${info.username}`);
      void this.initAvailability();
    });
    this.bot.on("message", (ctx) => {
      if (ctx.from?.isBot()) return;
      const text = ctx.text;
      if (!text) return;
      const chatId = this.brain.brainbase.telegram.chatId;
      if (chatId !== undefined && ctx.chat.id !== chatId) {
        logger.debug(
          `Telegram message: ignoring chat=${ctx.chat.id} (not bound to ${chatId})`,
        );
        return;
      }
      const inbound: PairingInbound = {
        content: text,
        time: new Date(ctx.createdAt * 1000),
        replyTo: String(ctx.id),
        chatId: ctx.chat.id,
      };
      if (chatId === undefined) {
        logger.debug(
          `Telegram message: routing to pairing (no chatId bound)`,
        );
        void this.onPairing(inbound);
        return;
      }
      this.chatId = ctx.chat.id;
      logger.debug(
        `Telegram message: dispatching (chat=${ctx.chat.id})`,
      );
      void this.onMessage({
        sender: "user",
        time: inbound.time,
        content: text,
      });
    });
    logger.debug(`TelegramChannel.init: starting bot`);
    await this.bot.start();
  }

  protected async sendPairingReply(
    text: string,
    inbound: PairingInbound,
  ): Promise<void> {
    if (!this.bot || inbound.chatId === undefined) {
      logger.debug(`sendPairingReply: no bot or chatId, skip`);
      return;
    }
    logger.debug(`sendPairingReply: posting to ${inbound.chatId}`);
    await this.bot.api.sendMessage({
      chat_id: inbound.chatId,
      text,
      ...(inbound.replyTo
        ? { reply_parameters: { message_id: Number(inbound.replyTo) } }
        : {}),
    });
  }

  protected override async completePairing(entry: PairingEntry): Promise<void> {
    if (entry.chatId !== undefined) {
      this.brain.brainbase.telegram.chatId = entry.chatId;
      this.chatId = entry.chatId;
      await this.brain.persistBrainBase();
      logger.success(
        `Telegram chat bound: ${this.brain.brainbase.displayName} → ${entry.chatId}`,
      );
    }
    await super.completePairing(entry);
  }

  async send(text: string, opts?: { replyTo?: string }): Promise<void> {
    if (!this.bot || this.chatId === undefined) {
      throw new Error("TelegramChannel.send: no chat yet (no inbound message)");
    }
    logger.debug(
      `send: posting ${text.length} chars${opts?.replyTo ? ` (reply to ${opts.replyTo})` : ""}`,
    );
    await this.bot.api.sendMessage({
      chat_id: this.chatId,
      text,
      ...(opts?.replyTo
        ? { reply_parameters: { message_id: Number(opts.replyTo) } }
        : {}),
    });
  }

  async setAvailability(_status: AvailabilityStatus): Promise<void> {
    logger.debug(
      `setAvailability: ${_status} (no-op, Telegram has no bot presence)`,
    );
    // ponytail: Telegram Bot API exposes no bot presence concept — no-op.
  }

  protected async teardownClient(): Promise<void> {
    if (!this.bot) {
      logger.debug(`teardownClient: no bot, nothing to stop`);
      return;
    }
    logger.debug(`teardownClient: stopping telegram bot`);
    await this.bot.stop(1000);
    this.bot = undefined;
  }
}
