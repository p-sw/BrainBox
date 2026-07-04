import { Bot } from "gramio";
import type { AvailabilityStatus } from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { BaseChannel } from "./base";
import type { BrainItemTelegram } from "@/brain/manager";
import type { Brain } from "@/brain";
import type { MessageHistoryEntry } from "@/brain/messageHistory";

const HISTORY_CAP = 1000;
// ponytail: one brain → one chat. First inbound message sets chat_id; multi-chat brains should add brainbase.telegram.chatId and skip auto-discovery.

export class TelegramChannel extends BaseChannel<BrainItemTelegram> {
  private bot?: Bot;
  private chatId?: number;
  private history: MessageHistoryEntry[] = [];

  constructor(brain: Brain<BrainItemTelegram>) {
    super(brain);
  }

  async init(): Promise<void> {
    this.bot = new Bot(this.brain.brainbase.telegram.token);
    this.bot.onStart(({ info }) => {
      logger.success(`Telegram ready as @${info.username}`);
    });
    this.bot.on("message", (ctx) => {
      if (ctx.from?.isBot()) return;
      const text = ctx.text;
      if (!text) return;
      if (this.chatId === undefined) this.chatId = ctx.chat.id;
      const entry: MessageHistoryEntry = {
        sender: "user",
        time: new Date(ctx.createdAt * 1000),
        content: text,
      };
      this.pushHistory(entry);
      void this.onMessage(entry);
    });
    await this.bot.start();
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
