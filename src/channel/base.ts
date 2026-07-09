import type { Brain } from "@/brain";
import type { BrainItemWithChannel } from "@/brain/manager";
import type { MessageHistoryEntry } from "@/brain/messageHistory";
import type { AvailabilityStatus } from "@/provider/schema";
import { logger } from "@/utils/logger";
import { formatDateKey } from "@/brain/schedule";
import { Cron, scheduledJobs, type CronCallback } from "croner";

const MESSAGE_DEBOUNCE_MS = 1500;
const IS_CHATTING_DEBOUNCE_MS = 1000 * 60 * 3; // 3m
const DEFERRED_QUEUE_CAP = 1000;
const AVAILABILITY_WATCHER_KEY = "__availability-watcher__";
const AVAILABILITY_WATCHER_PATTERN = "*/5 * * * *";
const SLEEP_MEMORY_CRON_KEY = "__sleep-memory__";
const SLEEP_MEMORY_CRON_PATTERN = "0 * * * *"; // every 1 hour
const START_CONVERSATION_CRON_KEY = "__start-conversation__";
const START_CONVERSATION_CRON_PATTERN = "*/10 * * * *"; // every 10 min
const DAILY_SCHEDULE_CRON_KEY = "__daily-schedule__";
const DAILY_SCHEDULE_CRON_PATTERN = "0 0 * * *"; // every day at 00:00
const DAILY_SCHEDULE_NOON_CRON_KEY = "__daily-schedule-noon__";
const DAILY_SCHEDULE_NOON_CRON_PATTERN = "0 12 * * *"; // every day at 12:00 (backup tick)

export interface PairingInbound {
  content: string;
  time: Date;
  replyTo?: string;
  channelId?: string;
  chatId?: number;
}

export interface PairingEntry {
  brainId: string;
  channelId?: string;
  chatId?: number;
}

export interface PairingCompletionResult {
  ok: boolean;
  error?: string;
  brainId?: string;
  displayName?: string;
}

export abstract class BaseChannel<
  BB extends BrainItemWithChannel = BrainItemWithChannel,
> {
  private messageInQueue: MessageHistoryEntry[] = [];
  private messageDebounce: NodeJS.Timeout | null = null;
  private isChatting: boolean = false; // Is brain ready to reply to chat?
  private isChattingDebounce: NodeJS.Timeout | null = null;
  private isSending: boolean = false; // Is brain generating messages to send?
  private isSendingQueue: MessageHistoryEntry[] = []; // Messages received while isSending = true
  private deferredQueue: MessageHistoryEntry[] = [];
  private previousAvailability: AvailabilityStatus | null = null;
  private startConversationCounters: Map<string, number> = new Map();
  protected isReady: boolean = false;
  protected pairingMode: boolean = false;
  private startConversationTimeout: boolean = false;

  private static pairingRegistry = new Map<string, PairingEntry>();
  private static activeChannels = new Map<string, BaseChannel>();

  constructor(protected readonly brain: Brain<BB>) {
    this.registerCron(
      SLEEP_MEMORY_CRON_KEY,
      SLEEP_MEMORY_CRON_PATTERN,
      async () => {
        const dateKey = formatDateKey(new Date());
        const availability = await this.brain.getAvailability();
        if (availability.status !== "offline") return;
        const existing = await this.brain.memory.get(
          `daily-journal:${dateKey}`,
        );
        if (existing) return;
        const history = await this.getMessageHistoryBetween(
          new Date(Date.now() - 24 * 60 * 60 * 1000),
          new Date(),
        );
        await this.brain.sleepMemory(new Date(), history);
      },
    );
    this.registerCron(
      DAILY_SCHEDULE_CRON_KEY,
      DAILY_SCHEDULE_CRON_PATTERN,
      () => this.regenerateSchedules(),
    );
    this.registerCron(
      DAILY_SCHEDULE_NOON_CRON_KEY,
      DAILY_SCHEDULE_NOON_CRON_PATTERN,
      () => this.regenerateSchedules(),
    );
    this.registerCron(
      START_CONVERSATION_CRON_KEY,
      START_CONVERSATION_CRON_PATTERN,
      () => this.runStartConversation(),
    );
  }

  private async regenerateSchedules(): Promise<void> {
    const today = new Date();
    const tomorrow = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );
    await this.brain.createDailySchedule(tomorrow);
    await this.brain.createDailySchedule(today);

    // merging monthly schedule with daily schedule, so it can keep check on missed monthly schedule generation
    const nextMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      today.getDate(),
    );
    await this.brain.createMonthlySchedule(nextMonth);
  }

  private async runStartConversation(): Promise<void> {
    if (!this.isReady) {
      logger.debug("startConversation: skip — not ready");
      return;
    }
    if (this.isChatting || this.startConversationTimeout) {
      logger.debug("startConversation: skip — chat in progress");
      return;
    }
    const availability = await this.brain.getAvailability();
    if (availability.status !== "online") {
      return;
    }
    const now = new Date();
    const dateKey = formatDateKey(now);
    const count = this.startConversationCounters.get(dateKey) ?? 0;
    const countThreshold = this.brain.brainbase.startConversationCountThreshold;
    if (count >= countThreshold) return;
    const nowMs = now.getTime();
    const history = await this.getMessageHistoryBetween(
      new Date(nowMs - 24 * 60 * 60 * 1000),
      now,
    );
    try {
      const replies = await this.brain.sendMessage(history, [], {
        initiate: true,
        send: this.send.bind(this),
      });
      if (replies.length === 0) return;
      this.startConversationCounters.set(dateKey, count + 1);
      this.startConversationTimeout = true;
      setTimeout(
        () => {
          this.startConversationTimeout = false;
        },
        this.brain.brainbase.startConversationTimeThreshold * 60 * 1000,
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logger.error(`startConversation sendMessage failed: ${reason}`);
    }
  }

  protected resolveCronPrefix() {
    return `${this.brain.brainbase.brainId}_`;
  }

  protected resolveCronName(key: string) {
    return this.resolveCronPrefix() + key;
  }

  protected registerCron<T = undefined>(
    key: string,
    pattern: string,
    callback: CronCallback<T>,
  ) {
    new Cron(
      pattern,
      {
        name: this.resolveCronName(key),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        catch: (e) =>
          logger.error(
            `Error while running cron ${this.resolveCronName(key)}: ${e}`,
          ),
      },
      callback,
    );
  }

  protected getRegisteredCrons() {
    return scheduledJobs
      .filter((c) => c.name && c.name.startsWith(this.resolveCronPrefix()))
      .map((c) => c.name as string);
  }

  protected pauseCron(key: string) {
    const job = scheduledJobs.find((c) => c.name === this.resolveCronName(key));
    if (!job) return false;
    job.pause();
  }

  protected resumeCron(key: string) {
    const job = scheduledJobs.find((c) => c.name === this.resolveCronName(key));
    if (!job) return false;
    job.resume();
  }

  protected removeCron(key: string) {
    const job = scheduledJobs.find((c) => c.name === this.resolveCronName(key));
    if (!job) return false;
    job.stop();
  }

  protected isCronStarted(key: string) {
    const job = scheduledJobs.find((c) => c.name === this.resolveCronName(key));
    if (!job) return false;
    return job.isRunning();
  }

  protected isCronBusy(key: string) {
    const job = scheduledJobs.find((c) => c.name === this.resolveCronName(key));
    if (!job) return false;
    return job.isBusy();
  }

  async onMessage(message: MessageHistoryEntry) {
    this.ensureAvailabilityWatcher();
    const availability = await this.brain.getAvailability();
    if (availability.status === "offline") {
      this.deferMessage(message, "offline");
      return;
    }
    if (
      !this.isChatting &&
      availability.status === "do-not-disturb" &&
      Math.random() > this.brain.brainbase.dndReplyProbability
    ) {
      this.deferMessage(message, "dnd");
      return;
    }

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

  private ensureAvailabilityWatcher(): void {
    if (this.isCronStarted(AVAILABILITY_WATCHER_KEY)) return;
    this.registerCron(
      AVAILABILITY_WATCHER_KEY,
      AVAILABILITY_WATCHER_PATTERN,
      async () => {
        const current = await this.brain.getAvailability();
        const prev = this.previousAvailability;
        this.previousAvailability = current.status;
        if (prev !== null && prev !== "online" && current.status === "online") {
          await this.flushDeferred();
        }
      },
    );
  }

  private async flushDeferred(): Promise<void> {
    if (this.deferredQueue.length === 0) return;
    const current = await this.brain.getAvailability();
    if (current.status !== "online") return;
    const drained = this.deferredQueue.splice(0, this.deferredQueue.length);
    for (const msg of drained) {
      void this.onMessage(msg);
    }
  }

  private deferMessage(message: MessageHistoryEntry, reason: string): void {
    this.deferredQueue.push(message);
    if (this.deferredQueue.length > DEFERRED_QUEUE_CAP) {
      this.deferredQueue.shift();
      logger.warn(
        `Deferred queue over cap (${DEFERRED_QUEUE_CAP}); dropped oldest`,
      );
    }
    logger.debug(
      `Deferred message (reason=${reason}); queue size=${this.deferredQueue.length}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Pairing
  //
  // When a brain has a channel token but no channel/chat id, the channel sits
  // in `pairingMode` until the user confirms via the CLI. Every inbound
  // message during pairing triggers `onPairing`, which replies with a fresh
  // code; the CLI consumes that code, persists the inbound's channel/chat id
  // onto the brain, and flips `isReady = true`.
  // ---------------------------------------------------------------------------

  static generatePairingCode(): string {
    const hex = "0123456789ABCDEF";
    let out = "";
    for (let i = 0; i < 8; i++) {
      if (i === 4) out += "-";
      out += hex[Math.floor(Math.random() * 16)];
    }
    return out;
  }

  protected registerActive(): void {
    BaseChannel.activeChannels.set(this.brain.brainbase.brainId, this);
  }

  protected unregisterActive(): void {
    BaseChannel.activeChannels.delete(this.brain.brainbase.brainId);
  }

  static all(): readonly BaseChannel[] {
    return Array.from(BaseChannel.activeChannels.values());
  }

  static async shutdownAll(): Promise<void> {
    await Promise.all(BaseChannel.all().map((c) => c.shutdown()));
  }

  /**
   * Tear down this channel. Stops the crons we own, clears pending timers,
   * removes us from the active-channels registry, and finally delegates
   * client/bot teardown to the subclass via {@link teardownClient}.
   */
  async shutdown(): Promise<void> {
    this.stopOwnCrons();
    this.clearTimers();
    this.unregisterActive();
    await this.teardownClient();
  }

  protected stopOwnCrons(): void {
    for (const key of this.getRegisteredCrons()) {
      this.removeCron(key);
    }
  }

  protected clearTimers(): void {
    if (this.messageDebounce) {
      clearTimeout(this.messageDebounce);
      this.messageDebounce = null;
    }
    if (this.isChattingDebounce) {
      clearTimeout(this.isChattingDebounce);
      this.isChattingDebounce = null;
    }
  }

  protected abstract teardownClient(): Promise<void>;

  protected engagePairing(): void {
    this.pairingMode = true;
    this.isReady = false;
  }

  protected abstract sendPairingReply(
    text: string,
    inbound: PairingInbound,
  ): Promise<void>;

  /**
   * Handle an inbound message while in pairing mode: register a fresh code,
   * then reply with start message + code + help. `onPairing` is wired as the
   * message event listener from each channel subclass.
   */
  protected async onPairing(inbound: PairingInbound): Promise<void> {
    const code = BaseChannel.generatePairingCode();
    BaseChannel.pairingRegistry.set(code, {
      brainId: this.brain.brainbase.brainId,
      channelId: inbound.channelId,
      chatId: inbound.chatId,
    });
    const displayName = this.brain.brainbase.displayName;
    const text = [
      `🔗 Pairing started for "${displayName}".`,
      ``,
      `Your pairing code: ${code}`,
      ``,
      `To finish pairing, run this on the host running the daemon:`,
      `  brainbox pairing ${code}`,
      ``,
      `The code is single-use. Send another message here if you need a new one.`,
    ].join("\n");
    logger.info(
      `Pairing code issued for "${displayName}": ${code} (channel=${
        inbound.channelId ?? `chat:${inbound.chatId}`
      })`,
    );
    await this.sendPairingReply(text, inbound);
  }

  /**
   * Finalize pairing by persisting the bound channel/chat id onto the
   * subclass's config. Subclasses override to write the id and refresh
   * their send target before calling super.
   */
  protected async completePairing(entry: PairingEntry): Promise<void> {
    this.pairingMode = false;
    this.isReady = true;
  }

  static async completePairingByCode(
    code: string,
  ): Promise<PairingCompletionResult> {
    const normalized = code.trim().toUpperCase();
    const entry = BaseChannel.pairingRegistry.get(normalized);
    if (!entry) {
      return { ok: false, error: "invalid or expired pairing code" };
    }
    const channel = BaseChannel.activeChannels.get(entry.brainId);
    if (!channel) {
      return {
        ok: false,
        error: "no active channel for that brain (is the daemon running?)",
      };
    }
    try {
      await channel.completePairing(entry);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `failed to persist pairing: ${reason}` };
    }
    BaseChannel.pairingRegistry.delete(normalized);
    return {
      ok: true,
      brainId: entry.brainId,
      displayName: channel.brain.brainbase.displayName,
    };
  }

  abstract init(): Promise<void>;

  abstract getMessageHistoryBetween(
    start: Date,
    end: Date,
  ): Promise<ReadonlyArray<MessageHistoryEntry>>;
  abstract send(text: string, opts?: { replyTo?: string }): Promise<void>;
  abstract setAvailability(status: AvailabilityStatus): Promise<void>;
}
