import type { Brain } from "@/brain";
import type { BrainItemWithChannel } from "@/brain/manager";
import type { MessageHistoryEntry } from "@/brain/messageHistory";
import type { AvailabilityStatus } from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { Cron, scheduledJobs, type CronCallback } from "croner";

const MESSAGE_DEBOUNCE_MS = 1500;
const IS_CHATTING_DEBOUNCE_MS = 1000 * 60 * 3; // 3m

export abstract class BaseChannel<
  BB extends BrainItemWithChannel = BrainItemWithChannel,
> {
  private messageInQueue: MessageHistoryEntry[] = [];
  private messageDebounce: NodeJS.Timeout | null = null;
  private isChatting: boolean = false; // Is brain ready to reply to chat?
  private isChattingDebounce: NodeJS.Timeout | null = null;
  private isSending: boolean = false; // Is brain generating messages to send?
  private isSendingQueue: MessageHistoryEntry[] = []; // Messages received while isSending = true

  constructor(protected readonly brain: Brain<BB>) {}

  protected registerCron<T = undefined>(
    key: string,
    pattern: string,
    callback: CronCallback<T>,
  ) {
    new Cron(
      pattern,
      {
        name: key,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        catch: (e) => logger.error(`Error while running cron ${key}: ${e}`),
      },
      callback,
    );
  }

  protected pauseCron(key: string) {
    const job = scheduledJobs.find((c) => c.name === key);
    if (!job) return false;
    job.pause();
  }

  protected resumeCron(key: string) {
    const job = scheduledJobs.find((c) => c.name === key);
    if (!job) return false;
    job.resume();
  }

  protected removeCron(key: string) {
    const job = scheduledJobs.find((c) => c.name === key);
    if (!job) return false;
    job.stop();
  }

  async onMessage(message: MessageHistoryEntry) {
    const availability = await this.brain.getAvailability();
    if (availability.status === "offline") return;
    if (
      !this.isChatting &&
      availability.status === "do-not-disturb" &&
      Math.random() > this.brain.brainbase.dndReplyProbability
    )
      return;

    if (!this.isSending) {
      this.messageInQueue.push(message);
      if (this.messageDebounce) clearTimeout(this.messageDebounce);
      this.messageDebounce = setTimeout(async () => {
        const newUserMessages = this.messageInQueue.splice(
          0,
          this.messageInQueue.length,
        );
        this.messageDebounce = null;
        const now = new Date();
        const twoDaysAgo = new Date(now);
        twoDaysAgo.setDate(now.getDate() - 2);
        this.isSending = true;
        try {
          await this.brain.sendMessage(
            await this.getMessageHistoryBetween(twoDaysAgo, now),
            newUserMessages,
            { send: this.send.bind(this) },
          );
        } catch (e) {
          logger.error(`Error while sending message: ${e}`);
        } finally {
          this.isSending = false;

          if (this.isSendingQueue.length > 0) {
            const queueMessages = this.isSendingQueue.splice(
              0,
              this.isSendingQueue.length,
            );
            let lastMessage: MessageHistoryEntry | undefined = undefined;
            while (!lastMessage && queueMessages.length > 0) {
              lastMessage = queueMessages.splice(-1, 1)[0];
            }
            if (lastMessage) {
              this.messageInQueue.push(...queueMessages);
              void this.onMessage(lastMessage);
            }
          }
        }
      }, MESSAGE_DEBOUNCE_MS);
    } else {
      this.isSendingQueue.push(message);
    }

    this.isChatting = true;
    if (this.isChattingDebounce) clearTimeout(this.isChattingDebounce);
    this.isChattingDebounce = setTimeout(() => {
      this.isChatting = false;
      this.isChattingDebounce = null;
    }, IS_CHATTING_DEBOUNCE_MS);
  }

  abstract init(): Promise<void>;

  abstract getMessageHistoryBetween(
    start: Date,
    end: Date,
  ): Promise<ReadonlyArray<MessageHistoryEntry>>;
  abstract send(text: string, opts?: { replyTo?: string }): Promise<void>;
  abstract setAvailability(status: AvailabilityStatus): Promise<void>;
}
