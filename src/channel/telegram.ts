import { Bot } from "gramio";
import type { AvailabilityStatus } from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { BaseChannel, type PairingInbound, type PairingEntry } from "./base";
import type { BrainItemTelegram } from "@/brain/manager";
import type { Brain } from "@/brain";
import type { MessageHistoryEntry } from "@/brain/messageHistory";

const HISTORY_CAP = 1000;

export class TelegramChannel extends BaseChannel<BrainItemTelegram> {
  private bot?: Bot;
  private chatId?: number;
  private history: MessageHistoryEntry[] = [];

  constructor(brain: Brain<BrainItemTelegram>) {
    super(brain);
  }

  async init(): Promise<void> {
    this.bot = new Bot(this.brain.brainbase.telegram.token);
    this.chatId = this.brain.brainbase.telegram.chatId;
    if (this.chatId !== undefined) {
      this.isReady = true;
    } else {
      this.engagePairing();
    }
    this.registerActive();
    this.bot.onStart(({ info }) => {
      logger.success(`Telegram ready as @${info.username}`);
    });
    this.bot.on("message", (ctx) => {
      if (ctx.from?.isBot()) return;
      const text = ctx.text;
      if (!text) return;
      const chatId = this.brain.brainbase.telegram.chatId;
      if (chatId !== undefined && ctx.chat.id !== chatId) {
        return;
      }
      const inbound: PairingInbound = {
        content: text,
        time: new Date(ctx.createdAt * 1000),
        replyTo: String(ctx.id),
        chatId: ctx.chat.id,
      };
      if (chatId === undefined) {
        void this.onPairing(inbound);
        return;
      }
      this.chatId = ctx.chat.id;
      const entry: MessageHistoryEntry = {
        sender: "user",
        time: inbound.time,
        content: text,
      };
      this.pushHistory(entry);
      void this.onMessage(entry);
    });
    await this.bot.start();
  }

  protected async sendPairingReply(
    text: string,
    inbound: PairingInbound,
  ): Promise<void> {
    if (!this.bot || inbound.chatId === undefined) return;
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
    await this.bot.api.sendMessage({
      chat_id: this.chatId,
      text,
      ...(opts?.replyTo
        ? { reply_parameters: { message_id: Number(opts.replyTo) } }
        : {}),
    });
  }

  async setAvailability(_status: AvailabilityStatus): Promise<void> {
    // ponytail: Telegram Bot API exposes no bot presence concept — no-op.
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
}
