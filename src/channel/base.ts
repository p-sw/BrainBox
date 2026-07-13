import { Brain } from "@/brain";
import type { BrainItemWithChannel } from "@/brain/manager";
import {
  appendMessageHistory,
  getMessageHistory as loadMessageHistory,
  type MessageHistoryEntry,
} from "@/brain/messageHistory";
import type { AvailabilityStatus } from "@/provider/schema";
import { logger } from "@/utils/logger";
import { formatDateKey, formatMonthKey } from "@/brain/schedule";
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
const SCHEDULE_CRON_KEY = "__schedule__";
const SCHEDULE_CRON_PATTERN = "0 0 * * *"; // every day at 00:00
const SCHEDULE_NOON_CRON_KEY = "__schedule-noon__";
const SCHEDULE_NOON_CRON_PATTERN = "0 12 * * *"; // every day at 12:00 (backup tick)

export const DO_ACTIONS = ["generateSchedule", "sleepMemory"] as const;
export type DoAction = (typeof DO_ACTIONS)[number];

export const VIEW_THINGS = [
  "daily-schedule",
  "monthly-schedule",
  "sending-queue",
  "deferred-queue",
  "today-availability",
  "persona",
  "base-system-prompt",
] as const;
export type ViewThing = (typeof VIEW_THINGS)[number];

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
    this.registerCron(SLEEP_MEMORY_CRON_KEY, SLEEP_MEMORY_CRON_PATTERN, () =>
      this.runSleepMemory(),
    );
    this.registerCron(SCHEDULE_CRON_KEY, SCHEDULE_CRON_PATTERN, () =>
      this.regenerateSchedules(),
    );
    this.registerCron(SCHEDULE_NOON_CRON_KEY, SCHEDULE_NOON_CRON_PATTERN, () =>
      this.regenerateSchedules(),
    );
    this.registerCron(
      START_CONVERSATION_CRON_KEY,
      START_CONVERSATION_CRON_PATTERN,
      () => this.runStartConversation(),
    );
  }

  private async runSleepMemory(force = false): Promise<void> {
    const dateKey = formatDateKey(new Date());
    if (!force) {
      const availability = await this.brain.getAvailability();
      if (availability.status !== "offline") {
        logger.debug(
          `sleepMemory cron: skip — availability=${availability.status}`,
        );
        return;
      }
      const existing = await this.brain.memory.get(`daily-journal:${dateKey}`);
      if (existing) {
        logger.debug(`sleepMemory cron: skip — journal for ${dateKey} exists`);
        return;
      }
    }
    const history = this.getMessageHistory(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
      new Date(),
    );
    await this.brain.sleepMemory(new Date(), history);
  }

  private async regenerateSchedules(): Promise<void> {
    logger.debug(
      `regenerateSchedules: tick for ${this.brain.brainbase.displayName}`,
    );
    await this.brain.regenerateSchedules();
    logger.debug(`regenerateSchedules: done`);
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
    const history = this.getMessageHistory(
      new Date(nowMs - 24 * 60 * 60 * 1000),
      now,
    );
    try {
      this.isSending = true;
      const replies = await this.brain.sendMessage(history, [], {
        initiate: true,
        send: this.sendAndRecord.bind(this),
      });
      this.isSending = false;
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
    const name = this.resolveCronName(key);
    logger.debug(`registerCron: ${name} (${pattern})`);
    new Cron(
      pattern,
      {
        name,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        catch: (e) => {
          logger.error(`Error while running cron ${name}: ${e}`);
          logger.debug(
            `Cron ${name} stack: ${e instanceof Error ? e.stack : "(no stack)"}`,
          );
        },
      },
      callback,
    );
  }

  protected getRegisteredCrons() {
    return scheduledJobs.filter(
      (c) => c.name && c.name.startsWith(this.resolveCronPrefix()),
    );
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
    logger.debug(
      `onMessage: received (${message.content.length} chars, sender=${message.sender})`,
    );
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
    logger.debug(
      `onMessage: passing through (availability=${availability.status})`,
    );

    this.enqueueForSend(message);

    this.isChatting = true;
    clearTimeout(this.isChattingDebounce);
    this.isChattingDebounce = setTimeout(() => {
      this.isChatting = false;
      this.isChattingDebounce = null;
    }, IS_CHATTING_DEBOUNCE_MS);
  }

  /** Queue a message that already passed availability and arm the send debounce. */
  private enqueueForSend(message: MessageHistoryEntry): void {
    if (this.isSending) {
      logger.debug(
        `onMessage: isSending — buffering into isSendingQueue (size=${this.isSendingQueue.length + 1})`,
      );
      this.isSendingQueue.push(message);
      return;
    }
    this.messageInQueue.push(message);
    logger.debug(
      `onMessage: queued (queueSize=${this.messageInQueue.length})`,
    );
    this.armMessageDebounce();
  }

  private armMessageDebounce(): void {
    clearTimeout(this.messageDebounce);
    this.messageDebounce = setTimeout(async () => {
      const newUserMessages = this.messageInQueue.splice(
        0,
        this.messageInQueue.length,
      );
      this.messageDebounce = null;
      if (newUserMessages.length === 0) return;
      logger.debug(
        `onMessage: debounce fired, dispatching ${newUserMessages.length} message(s)`,
      );
      const now = new Date();
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(now.getDate() - 2);
      this.isSending = true;
      try {
        // History snapshot first so new user msgs aren't duplicated in the prompt.
        const history = this.getMessageHistory(twoDaysAgo, now);
        for (const m of newUserMessages) this.saveMessageHistory(m);
        await this.brain.sendMessage(history, newUserMessages, {
          send: this.sendAndRecord.bind(this),
        });
      } catch (e) {
        logger.error(`Error while sending message: ${e}`);
        logger.debug(
          `onMessage: sendMessage threw — ${e instanceof Error ? e.stack : String(e)}`,
        );
      } finally {
        this.isSending = false;
        if (this.isSendingQueue.length > 0) {
          const queueMessages = this.isSendingQueue.splice(
            0,
            this.isSendingQueue.length,
          );
          logger.debug(
            `onMessage: draining ${queueMessages.length} queued message(s) from isSendingQueue`,
          );
          // ponytail: all drained msgs already passed availability at receipt;
          // re-arm debounce so none are orphaned if a re-check would defer.
          this.messageInQueue.push(...queueMessages);
        }
        if (this.messageInQueue.length > 0) this.armMessageDebounce();
      }
    }, MESSAGE_DEBOUNCE_MS);
  }

  /**
   * Apply current schedule availability to the platform presence and start
   * the transition watcher. Call once the channel client is ready.
   */
  protected async initAvailability(): Promise<void> {
    const current = await this.brain.getAvailability();
    this.previousAvailability = current.status;
    logger.debug(`initAvailability: ${current.status}`);
    await this.setAvailability(current.status);
    this.ensureAvailabilityWatcher();
  }

  private ensureAvailabilityWatcher(): void {
    if (this.isCronStarted(AVAILABILITY_WATCHER_KEY)) return;
    logger.debug(
      `ensureAvailabilityWatcher: starting ${AVAILABILITY_WATCHER_PATTERN} watcher`,
    );
    this.registerCron(
      AVAILABILITY_WATCHER_KEY,
      AVAILABILITY_WATCHER_PATTERN,
      async () => {
        const current = await this.brain.getAvailability();
        const prev = this.previousAvailability;
        this.previousAvailability = current.status;
        logger.debug(
          `availabilityWatcher: ${prev ?? "(initial)"} → ${current.status}`,
        );
        if (prev !== current.status) {
          await this.setAvailability(current.status);
        }
        if (prev !== null && prev !== "online" && current.status === "online") {
          await this.flushDeferred();
        }
      },
    );
  }

  private async flushDeferred(): Promise<void> {
    if (this.deferredQueue.length === 0) {
      logger.debug(`flushDeferred: nothing to flush`);
      return;
    }
    const current = await this.brain.getAvailability();
    if (current.status !== "online") {
      logger.debug(
        `flushDeferred: skip — still ${current.status} (deferred size=${this.deferredQueue.length})`,
      );
      return;
    }
    const drained = this.deferredQueue.splice(0, this.deferredQueue.length);
    logger.debug(`flushDeferred: replaying ${drained.length} message(s)`);
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

  /** Kick off a cron job for a live brain; returns once accepted, not when done. */
  static forceDo(
    brainId: string,
    action: DoAction,
  ): { ok: true; displayName: string } | { ok: false; error: string } {
    const channel = BaseChannel.activeChannels.get(brainId);
    if (!channel) {
      return {
        ok: false,
        error: `no active channel for brain "${brainId}" (is it activated and daemon running?)`,
      };
    }
    const displayName = channel.brain.brainbase.displayName;
    logger.info(`do ${action}: queued for "${displayName}" (${brainId})`);
    void (async () => {
      try {
        if (action === "generateSchedule") {
          await channel.regenerateSchedules();
        } else {
          await channel.runSleepMemory(true);
        }
        logger.success(`do ${action}: done for "${displayName}" (${brainId})`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(
          `do ${action}: failed for "${displayName}" (${brainId}): ${reason}`,
        );
      }
    })();
    return { ok: true, displayName };
  }

  /** Snapshot an internal brain/channel value for CLI inspection. */
  static async view(
    brainId: string,
    thing: ViewThing,
  ): Promise<
    | { ok: true; displayName: string; value: unknown }
    | { ok: false; error: string }
  > {
    const channel = BaseChannel.activeChannels.get(brainId);
    if (!channel) {
      return {
        ok: false,
        error: `no active channel for brain "${brainId}" (is it activated and daemon running?)`,
      };
    }
    const displayName = channel.brain.brainbase.displayName;
    logger.debug(`view ${thing}: "${displayName}" (${brainId})`);
    return {
      ok: true,
      displayName,
      value: await channel.readView(thing),
    };
  }

  private async readView(thing: ViewThing): Promise<unknown> {
    const now = new Date();
    switch (thing) {
      case "daily-schedule": {
        const key = formatDateKey(now);
        const stored = await this.brain.memory.get(`daily-schedule:${key}`);
        if (!stored) return null;
        try {
          return { key, schedule: JSON.parse(stored.content) };
        } catch {
          return { key, raw: stored.content };
        }
      }
      case "monthly-schedule": {
        const key = formatMonthKey(now);
        const stored = await this.brain.memory.get(`monthly-schedule:${key}`);
        if (!stored) return null;
        try {
          return { key, schedule: JSON.parse(stored.content) };
        } catch {
          return { key, raw: stored.content };
        }
      }
      case "sending-queue":
        return this.isSendingQueue.map((m) => ({
          sender: m.sender,
          time: m.time.toISOString(),
          content: m.content,
        }));
      case "deferred-queue":
        return this.deferredQueue.map((m) => ({
          sender: m.sender,
          time: m.time.toISOString(),
          content: m.content,
        }));
      case "today-availability":
        return await this.brain.getTodayScheduledAvailability(now);
      case "persona": {
        const stored = await this.brain.memory.get("persona");
        return stored?.content ?? null;
      }
      case "base-system-prompt":
        return this.brain.brainbase.baseSystemPrompt;
    }
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
    logger.debug(`shutdown: tearing down ${this.brain.brainbase.displayName}`);
    this.stopOwnCrons();
    this.clearTimers();
    this.unregisterActive();
    await this.teardownClient();
    logger.debug(`shutdown: done`);
  }

  protected stopOwnCrons(): void {
    for (const cron of this.getRegisteredCrons()) {
      cron.stop();
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

  /** Unified SQLite-backed history for this brain's channel. */
  getMessageHistory(
    start: Date,
    end: Date,
  ): ReadonlyArray<MessageHistoryEntry> {
    return loadMessageHistory(this.brain.brainbase.brainId, start, end);
  }

  /** Persist a message that actually entered the LLM/send path. */
  protected saveMessageHistory(entry: MessageHistoryEntry): void {
    appendMessageHistory(this.brain.brainbase.brainId, entry);
  }

  /** Channel send + record persona reply into history. */
  private async sendAndRecord(text: string): Promise<void> {
    await this.send(text);
    this.saveMessageHistory({
      sender: "persona",
      time: new Date(),
      content: text,
    });
  }

  abstract send(text: string, opts?: { replyTo?: string }): Promise<void>;
  abstract setAvailability(status: AvailabilityStatus): Promise<void>;
}
