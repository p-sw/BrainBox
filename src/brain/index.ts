import { randomUUID } from "node:crypto";
import Supermemory from "supermemory";
import { config } from "@/config";
import { llm } from "@/provider";
import { loadPrompt } from "@/provider/promptLoader";
import {
  availabilitySchema,
  baseSystemPromptSchema,
  dailyScheduleSchema,
  monthlyScheduleSchema,
  type Availability,
  type AvailabilityWindows,
  type BaseSystemPromptGeneration,
  type DailySchedule,
  type DailySlot,
  type MonthlySchedule,
} from "@/provider/schema";
import { logger } from "@/utils/logger";
import { BadRequestResponseError } from "@openrouter/sdk/models/errors";

const log = logger.child("brain");
import type { ChatFunctionTool, ChatMessages, ToolCall } from "@/provider";
import {
  brainManager,
  type BrainItem,
  type BrainItemWithChannel,
} from "./manager";
import {
  translateMessageHistory,
  type MessageHistoryEntry,
} from "./messageHistory";
import { formatDateKey, formatMonthKey, pad2 } from "./schedule";
import type { Space } from "./types";
import { Memory } from "./memory";

function toMinutes(hhmm: string): number {
  const [hh = 0, mm = 0] = hhmm.split(":").map((x) => parseInt(x, 10));
  return hh * 60 + mm;
}

/** Inclusive of start, exclusive of end. Supports overnight (start > end). */
function minutesInWindow(current: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return start <= current && current < end;
  return current >= start || current < end;
}

export interface BrainCreateResult {
  brain: Brain;
  description: string;
  baseSystemPrompt: string;
}

export class Brain<BB extends BrainItem = BrainItem> {
  private availabilityCache: Map<string, AvailabilityWindows> = new Map();

  public memory: Memory;
  constructor(
    private db: Supermemory,
    private space: Space,
    public brainbase: BB,
    memory?: Memory,
  ) {
    this.memory = memory ?? new Memory(this.db, this.space);
    log.debug(
      `Brain constructed: id=${brainbase.brainId} name=${brainbase.displayName} space=${space.name}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Domain methods
  // ---------------------------------------------------------------------------

  async createDailySchedule(datetime: Date): Promise<DailySchedule | null> {
    const dateKey = formatDateKey(datetime);
    log.debug(`createDailySchedule: starting for ${dateKey}`);
    try {
      const existing = await this.memory.get(`daily-schedule:${dateKey}`);
      if (existing) {
        log.debug(`createDailySchedule: cache hit for ${dateKey}`);
        try {
          return JSON.parse(existing.content) as DailySchedule;
        } catch (parseErr) {
          log.debug(
            `createDailySchedule: stored schedule malformed, regenerating: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          );
          // fall through to regeneration if stored content is malformed
        }
      }

      const twoDaysAgo = new Date(datetime);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoKey = formatDateKey(twoDaysAgo);
      log.debug(
        `createDailySchedule: gathering context (monthly, history, ${twoDaysAgoKey})`,
      );
      const [monthlySummary, history, twoDaysAgoStored] = await Promise.all([
        this.getMonthlySummaryForDay(datetime),
        this.getHistoryFacts(),
        this.memory.get(`daily-schedule:${twoDaysAgoKey}`),
      ]);
      let twoDaysAgoSchedule: DailySchedule | null = null;
      if (twoDaysAgoStored) {
        try {
          twoDaysAgoSchedule = JSON.parse(
            twoDaysAgoStored.content,
          ) as DailySchedule;
          log.debug(
            `createDailySchedule: loaded prior schedule with ${twoDaysAgoSchedule.items.length} slots`,
          );
        } catch {
          twoDaysAgoSchedule = null;
          log.debug(`createDailySchedule: prior schedule malformed, ignoring`);
        }
      }

      const instruction = await loadPrompt("DAILY_SCHEDULE");
      const promptMessage = [
        `Target date: ${dateKey} (${datetime.toLocaleDateString("en-US", { weekday: "long" })})`,
        `Personality: ${this.brainbase.baseSystemPrompt}`,
        monthlySummary
          ? `Monthly summary for this day: ${monthlySummary}`
          : "(no monthly summary available for this date)",
        `Recent schedule (${twoDaysAgoKey}, 2 days ago): ${
          twoDaysAgoSchedule
            ? twoDaysAgoSchedule.items
                .map((s) => `${s.start} ${s.activity}`)
                .join(", ")
            : "(no schedule on file for 2 days ago)"
        }`,
        `Recent history (facts):`,
        history,
      ].join("\n\n");

      log.debug(`createDailySchedule: calling identity model`);
      const schedule = await llm.call<DailySchedule>(llm.models.identity, {
        caller: "daily-schedule",
        instruction,
        message: promptMessage,
        jsonSchemaName: "daily-schedule",
        jsonSchema: dailyScheduleSchema,
      });
      log.debug(
        `createDailySchedule: model returned ${schedule.items.length} slots`,
      );

      await this.memory.add({
        customId: `daily-schedule:${dateKey}`,
        content: JSON.stringify(schedule),
        metadata: {
          kind: "schedule",
          source: "createDailySchedule",
          date: dateKey,
        },
      });
      this.availabilityCache.delete(dateKey);
      log.debug(`createDailySchedule: persisted ${dateKey}`);

      return schedule;
    } catch (error) {
      let reason =
        error instanceof Error
          ? error.message + `(${error.name})`
          : String(error);
      if (error instanceof BadRequestResponseError)
        reason = reason + `${error.body}`;
      logger.error(`createDailySchedule failed: ${reason}`);
      return null;
    }
  }

  async regenerateSchedules(): Promise<void> {
    const today = new Date();
    const nextMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      today.getDate(),
    );
    const monthly = await this.createMonthlySchedule(nextMonth);
    if (!monthly) {
      log.debug(
        `regenerateSchedules: skip daily — monthly schedule generation failed`,
      );
      return;
    }

    const tomorrow = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );

    await this.createDailySchedule(tomorrow);
    await this.createDailySchedule(today);
    this.invalidateScheduledAvailability(today);
  }

  async createMonthlySchedule(datetime: Date): Promise<MonthlySchedule | null> {
    // Use the caller's month as-is. regenerateSchedules already advances to next month.
    const year = datetime.getFullYear();
    const month = datetime.getMonth(); // 0-based
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthKey = formatMonthKey(datetime);
    log.debug(`createMonthlySchedule: starting for ${monthKey}`);
    try {
      const existing = await this.memory.get(`monthly-schedule:${monthKey}`);
      if (existing) {
        log.debug(`createMonthlySchedule: cache hit for ${monthKey}`);
        try {
          return JSON.parse(existing.content) as MonthlySchedule;
        } catch (parseErr) {
          log.debug(
            `createMonthlySchedule: stored schedule malformed, regenerating: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          );
          // fall through to regeneration if stored content is malformed
        }
      }

      const twoMonthsAgo = new Date(year, month - 2, 1);
      const twoMonthsAgoKey = `${twoMonthsAgo.getFullYear()}-${pad2(twoMonthsAgo.getMonth() + 1)}`;
      log.debug(
        `createMonthlySchedule: gathering context (history, ${twoMonthsAgoKey})`,
      );
      const [history, twoMonthsAgoStored] = await Promise.all([
        this.getHistoryFacts(),
        this.memory.get(`monthly-schedule:${twoMonthsAgoKey}`),
      ]);
      let twoMonthsAgoSchedule: MonthlySchedule | null = null;
      if (twoMonthsAgoStored) {
        try {
          twoMonthsAgoSchedule = JSON.parse(
            twoMonthsAgoStored.content,
          ) as MonthlySchedule;
          log.debug(
            `createMonthlySchedule: loaded prior schedule with ${twoMonthsAgoSchedule.items.length} days`,
          );
        } catch {
          twoMonthsAgoSchedule = null;
          log.debug(
            `createMonthlySchedule: prior schedule malformed, ignoring`,
          );
        }
      }

      const instruction = await loadPrompt("MONTHLY_SCHEDULE");
      const promptMessage = [
        `Target month: ${monthKey} (${daysInMonth} days)`,
        `Personality: ${this.brainbase.baseSystemPrompt}`,
        `Recent schedule (${twoMonthsAgoKey}, 2 months ago): ${
          twoMonthsAgoSchedule
            ? twoMonthsAgoSchedule.items
                .map((s) => `Day ${s.day}: ${s.summary}`)
                .join(", ")
            : "(no schedule on file for 2 months ago)"
        }`,
        `Recent history (facts):`,
        history,
      ].join("\n\n");

      log.debug(`createMonthlySchedule: calling identity model`);
      const schedule = await llm.call<MonthlySchedule>(llm.models.identity, {
        caller: "monthly-schedule",
        instruction,
        message: promptMessage,
        jsonSchemaName: "monthly-schedule",
        jsonSchema: monthlyScheduleSchema,
      });
      log.debug(
        `createMonthlySchedule: model returned ${schedule.items.length} days`,
      );

      await this.memory.add({
        customId: `monthly-schedule:${monthKey}`,
        content: JSON.stringify(schedule),
        metadata: {
          kind: "schedule",
          source: "createMonthlySchedule",
          month: monthKey,
        },
      });
      log.debug(`createMonthlySchedule: persisted ${monthKey}`);

      return schedule;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`createMonthlySchedule failed: ${reason}`);
      return null;
    }
  }

  async sleepMemory(
    datetime: Date = new Date(),
    history: ReadonlyArray<MessageHistoryEntry>,
  ): Promise<string | null> {
    if (history.length === 0) {
      log.debug(`sleepMemory: no history, skipping`);
      return null;
    }
    log.debug(`sleepMemory: starting, ${history.length} messages`);
    try {
      const dateKey = formatDateKey(datetime);
      const instruction = await loadPrompt("MEMOIR");
      const historyBlock = translateMessageHistory(
        this.brainbase.displayName,
        history,
      );
      const promptMessage = [
        `Date: ${dateKey}`,
        `Personality: ${this.brainbase.baseSystemPrompt}`,
        `Conversation log:`,
        historyBlock,
      ].join("\n\n");

      log.debug(`sleepMemory: calling identity model`);
      const memoir = await llm.call<string>(llm.models.identity, {
        caller: "sleep-memory",
        instruction,
        message: promptMessage,
      });
      log.debug(`sleepMemory: model returned ${memoir.length} chars`);

      await this.memory.add({
        customId: `daily-journal:${dateKey}`,
        content: memoir,
        metadata: {
          kind: "daily-journal",
          source: "sleepMemory",
          date: dateKey,
        },
      });
      log.debug(`sleepMemory: journal persisted for ${dateKey}`);

      return memoir;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`sleepMemory failed: ${reason}`);
      return null;
    }
  }

  async getTodayScheduledAvailability(
    datetime: Date,
  ): Promise<AvailabilityWindows | null> {
    const dateKey = formatDateKey(datetime);
    try {
      const cached = this.availabilityCache.get(dateKey);
      if (cached) {
        log.debug(`getTodayScheduledAvailability: cache hit for ${dateKey}`);
        return cached;
      }

      const stored = await this.memory.get(`daily-schedule:${dateKey}`);
      if (!stored) {
        log.debug(`getTodayScheduledAvailability: no schedule for ${dateKey}`);
        return null;
      }

      const dailySchedule = JSON.parse(stored.content) as DailySchedule;
      const availability =
        await this.deriveAvailabilityFromSchedule(dailySchedule);

      this.availabilityCache.set(dateKey, availability);
      log.debug(
        `getTodayScheduledAvailability: cached ${availability.items.length} windows for ${dateKey}`,
      );
      return availability;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`getTodayScheduledAvailability failed: ${reason}`);
      return null;
    }
  }

  async getAvailability(datetime: Date = new Date()): Promise<Availability> {
    const h = datetime.getHours();
    const m = datetime.getMinutes();
    const hhmm = `${pad2(h)}:${pad2(m)}`;
    const current = h * 60 + m;
    const windows = await this.getTodayScheduledAvailability(datetime);
    const match = windows?.items.find((w) =>
      minutesInWindow(current, toMinutes(w.start), toMinutes(w.end)),
    );
    const result = match ?? { start: hhmm, end: hhmm, status: "offline" };
    log.debug(
      `getAvailability: now=${hhmm} status=${result.status} (${windows?.items.length ?? 0} windows on file)`,
    );
    return result;
  }

  async getCurrentAndAdjacentSlots(now: Date): Promise<DailySlot[]> {
    const dateKey = formatDateKey(now);
    const stored = await this.memory.get(`daily-schedule:${dateKey}`);
    if (!stored) {
      log.debug(`getCurrentAndAdjacentSlots: no schedule for ${dateKey}`);
      return [];
    }
    let schedule: DailySchedule;
    try {
      schedule = JSON.parse(stored.content) as DailySchedule;
    } catch (parseErr) {
      log.debug(
        `getCurrentAndAdjacentSlots: stored schedule malformed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
      return [];
    }
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const index = schedule.items.findIndex((slot) =>
      minutesInWindow(
        currentMinutes,
        toMinutes(slot.start),
        toMinutes(slot.end),
      ),
    );
    if (index === -1) {
      log.debug(
        `getCurrentAndAdjacentSlots: no matching slot at ${now.toTimeString().slice(0, 5)}`,
      );
      return [];
    }
    const slice = schedule.items.slice(Math.max(0, index - 1), index + 2);
    log.debug(
      `getCurrentAndAdjacentSlots: index=${index} returned ${slice.length} slots`,
    );
    return slice;
  }

  async deriveAvailabilityFromSchedule(
    schedule: DailySchedule,
  ): Promise<AvailabilityWindows> {
    log.debug(
      `deriveAvailabilityFromSchedule: ${schedule.items.length} slots → model`,
    );
    try {
      const instruction = await loadPrompt("SCHEDULE_AVAILABILITY");
      const promptMessage = JSON.stringify({
        schedule,
        personality: this.brainbase.baseSystemPrompt,
      });

      const result = await llm.call<AvailabilityWindows>(llm.models.identity, {
        caller: "availability",
        instruction,
        message: promptMessage,
        jsonSchemaName: "availability",
        jsonSchema: availabilitySchema,
      });
      log.debug(
        `deriveAvailabilityFromSchedule: ${result.items.length} windows`,
      );
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`deriveAvailabilityFromSchedule failed: ${reason}`);
      throw error;
    }
  }

  invalidateScheduledAvailability(datetime: Date = new Date()): void {
    const todayKey = formatDateKey(datetime);
    // Drop today (and any stale past keys) so regen/forceDo picks up new windows.
    this.availabilityCache.delete(todayKey);
    let removed = 1;
    for (const key of this.availabilityCache.keys()) {
      if (key < todayKey) {
        this.availabilityCache.delete(key);
        removed += 1;
      }
    }
    log.debug(
      `invalidateScheduledAvailability: dropped cache for ${todayKey} (+ stale); ~${removed} keys touched`,
    );
  }

  async persistBrainBase(): Promise<void> {
    log.debug(
      `persistBrainBase: id=${this.brainbase.brainId} name=${this.brainbase.displayName}`,
    );
    await brainManager.saveBrain(this.brainbase.brainId, this.brainbase);
  }

  async sendMessage(
    history: ReadonlyArray<MessageHistoryEntry>,
    newMessages: ReadonlyArray<MessageHistoryEntry>,
    options: {
      now?: Date;
      maxSteps?: number;
      initiate?: boolean;
      send?: (text: string) => Promise<void>;
    } = {},
  ): Promise<string[]> {
    const now = options.now ?? new Date();
    const maxSteps = options.maxSteps ?? 20;
    const initiate = options.initiate ?? false;
    const send = options.send ?? (async () => {});

    log.debug(
      `sendMessage: start initiate=${initiate} history=${history.length} new=${newMessages.length} maxSteps=${maxSteps}`,
    );

    const replyMessages: string[] = [];
    const tools: ChatFunctionTool[] = buildSendMessageTools();
    const historyBlock = translateMessageHistory(
      this.brainbase.displayName,
      history,
    );
    const newBlock = translateMessageHistory(
      this.brainbase.displayName,
      newMessages,
    );
    const memoryBlock = await this.buildMemoryBlock();
    const scheduleBlock = await this.buildScheduleBlock(now);
    const datetimeBlock = formatDatetime(now);

    const language = this.brainbase.language?.trim() || "English";
    const instruction = initiate
      ? await loadPrompt("START_CONVERSATION")
      : await loadPrompt("SEND_MESSAGE");
    const userPrompt = initiate
      ? [
          `Current date and time: ${datetimeBlock}`,
          `Language: ${language}`,
          scheduleBlock,
          memoryBlock,
          `Conversation so far:`,
          historyBlock.length > 0 ? historyBlock : "(no prior messages)",
          `You are opening this chat. The user has not sent a message.`,
        ].join("\n\n")
      : [
          `Current date and time: ${datetimeBlock}`,
          `Language: ${language}`,
          scheduleBlock,
          memoryBlock,
          `Conversation so far:`,
          historyBlock.length > 0 ? historyBlock : "(no prior messages)",
          `New user message(s) to which you must reply:`,
          newBlock.length > 0 ? newBlock : "(none — open turn)",
        ].join("\n\n");

    const messages: ChatMessages[] = [
      {
        role: "user",
        content: userPrompt,
      },
    ];

    try {
      await llm.chatWithToolExecution(llm.models.conversation, {
        caller: initiate ? "start-conversation" : "send-message",
        instruction: `${this.brainbase.baseSystemPrompt}\n\nLanguage: always reply in ${language}.\n\n${instruction}`,
        messages,
        tools,
        maxSteps,
        executeTool: async (call: ToolCall) => {
          if (call.function.name === "addReplyMessage") {
            const content = parseAddReplyMessageArguments(
              call.function.arguments,
            );
            if (content !== null) {
              log.debug(
                `sendMessage: addReplyMessage[${replyMessages.length}] (${content.length} chars)`,
              );
              await send(content);
              replyMessages.push(content);
              return JSON.stringify({
                ok: true,
                index: replyMessages.length - 1,
              });
            }
            log.debug(
              `sendMessage: addReplyMessage rejected (invalid arguments: ${call.function.arguments})`,
            );
            return JSON.stringify({ ok: false, error: "invalid arguments" });
          }
          if (call.function.name === "searchMemory") {
            log.debug(`sendMessage: searchMemory tool call`);
            return this.executeSearchTool(call.function.arguments);
          }
          if (call.function.name === "stop") {
            log.debug(`sendMessage: stop tool call`);
            return JSON.stringify({ ok: true });
          }
          log.debug(`sendMessage: unknown tool "${call.function.name}"`);
          return JSON.stringify({
            ok: false,
            error: `Unknown tool: ${call.function.name}`,
          });
        },
        shouldEnd: (toolCalls) =>
          toolCalls.some((c) => c.function.name === "stop"),
        onNoToolCalls: () => {
          // After at least one send, bare end is fine. Otherwise require stop or send.
          if (replyMessages.length > 0) return null;
          return (
            "If you do not want to send a message, call the `stop` tool explicitly to end your turn. " +
            "If you meant to send a message but ended by mistake, call `addReplyMessage`."
          );
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`sendMessage: LLM call failed: ${reason}`);
    }

    log.debug(
      `sendMessage: done with ${replyMessages.length} replies`,
    );
    return replyMessages;
  }

  private async buildMemoryBlock(): Promise<string> {
    const facts = await this.getHistoryFacts();
    return `Known facts about the persona and the user:\n${facts || "(none indexed)"}`;
  }

  private async buildScheduleBlock(now: Date): Promise<string> {
    const dateKey = formatDateKey(now);
    const currentSlots = await this.getCurrentAndAdjacentSlots(now);
    const currentBlock =
      currentSlots.length > 0
        ? `Currently (around ${now.toTimeString().slice(0, 5)}):\n${currentSlots
            .map(
              (s) =>
                `  ${s.start}-${s.end} ${s.activity}${s.notes ? ` (${s.notes})` : ""}`,
            )
            .join("\n")}`
        : `Currently (${dateKey} ${now.toTimeString().slice(0, 5)}): (no matching slot in today's schedule)`;

    const days: { label: string; date: Date }[] = [
      {
        label: "Yesterday",
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
      },
      {
        label: "Tomorrow",
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
      },
    ];
    const blocks: string[] = [];
    for (const { label, date } of days) {
      const key = formatDateKey(date);
      const summary = await this.getDailyScheduleSummary(key);
      blocks.push(
        `${label} (${key}): ${summary ?? "(no daily schedule on file)"}`,
      );
    }
    return `Schedule context:\n${currentBlock}\n\n${blocks.join("\n")}`;
  }

  private async getDailyScheduleSummary(
    dateKey: string,
  ): Promise<string | null> {
    try {
      const stored = await this.memory.get(`daily-schedule:${dateKey}`);
      if (!stored) return null;
      const schedule = JSON.parse(stored.content) as DailySchedule;
      const first = schedule.items[0];
      const last = schedule.items[schedule.items.length - 1];
      if (!first || !last) return null;
      const total = schedule.items.length;
      return `starts ${first.activity}@${first.start}, ends ${last.activity}@${last.end} (${total} slots)`;
    } catch {
      return null;
    }
  }

  private async executeSearchTool(argumentsJson: string): Promise<string> {
    const query = parseSearchArguments(argumentsJson);
    if (!query) {
      log.debug(`executeSearchTool: missing/invalid query in args`);
      return JSON.stringify({ ok: false, error: "missing query" });
    }
    log.debug(`executeSearchTool: query="${query}"`);
    try {
      const hits = await this.memory.search(query, 5);
      const compact = hits.map((hit) => ({
        content: hit.content,
        score: hit.score,
      }));
      log.debug(`executeSearchTool: ${compact.length} hits returned to model`);
      return JSON.stringify({ ok: true, hits: compact });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.debug(`executeSearchTool: failed: ${reason}`);
      return JSON.stringify({ ok: false, error: reason });
    }
  }

  async getMonthlySummaryForDay(target: Date): Promise<string | null> {
    try {
      const monthKey = formatMonthKey(target);
      const stored = await this.memory.get(`monthly-schedule:${monthKey}`);
      if (!stored) {
        log.debug(
          `getMonthlySummaryForDay: no monthly schedule for ${monthKey}`,
        );
        return null;
      }

      const monthly = JSON.parse(stored.content) as MonthlySchedule;
      const day = target.getDate();
      const entry = monthly.items.find((d) => d.day === day);
      log.debug(
        `getMonthlySummaryForDay: month=${monthKey} day=${day} ${entry ? "hit" : "miss"}`,
      );
      return entry?.summary ?? null;
    } catch (parseErr) {
      log.debug(
        `getMonthlySummaryForDay: parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
      return null;
    }
  }

  async getHistoryFacts(): Promise<string> {
    try {
      const docs = await this.memory.list();
      // Schedules/persona JSON are not conversational facts.
      const facts = docs.filter((d) => {
        const id = d.customId ?? "";
        return (
          !id.startsWith("daily-schedule:") &&
          !id.startsWith("monthly-schedule:") &&
          id !== "persona"
        );
      });
      const text = facts
        .map((d) => d.content)
        .slice(-30)
        .join("\n");
      log.debug(
        `getHistoryFacts: ${facts.length}/${docs.length} fact docs, ${text.length} chars`,
      );
      return text;
    } catch (err) {
      log.debug(
        `getHistoryFacts: failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return "";
    }
  }

  static async create(
    displayName: string,
    seed: string,
    options: { language?: string } = {},
  ): Promise<{ brainId: string; brain: Brain } | { error: string }> {
    const language = (options.language ?? "English").trim() || "English";
    log.debug(
      `Brain.create: starting name="${displayName}" language="${language}"`,
    );
    try {
      const personaInitInstruction = await loadPrompt("PERSONA_INIT");
      log.debug(`Brain.create: generating description`);
      const description = await llm.call<string>(llm.models.identity, {
        caller: "persona-init",
        instruction: personaInitInstruction,
        message: [`Language: ${language}`, `Seed:`, seed].join("\n\n"),
      });
      log.debug(
        `Brain.create: description returned (${description.length} chars)`,
      );

      const personaSystemInstruction = await loadPrompt(
        "PERSONA_BASE_SYSTEM_PROMPT",
      );
      log.debug(`Brain.create: generating base system prompt + dials`);
      const generated = await llm.call<BaseSystemPromptGeneration>(
        llm.models.identity,
        {
          caller: "base-system-prompt",
          instruction: personaSystemInstruction,
          message: [
            `Language: ${language}`,
            `Biography:`,
            description,
          ].join("\n\n"),
          jsonSchemaName: "base-system-prompt",
          jsonSchema: baseSystemPromptSchema,
        },
      );
      log.debug(
        `Brain.create: dials dndProb=${generated.dndReplyProbability} startCountThreshold=${generated.startConversationCountThreshold} startTimeThreshold=${generated.startConversationTimeThreshold}`,
      );

      const personaSystemFixed = await loadPrompt(
        "PERSONA_BASE_SYSTEM_PROMPT_FIXED",
      );
      const baseSystemPrompt = `${generated.baseSystemPrompt}\n\n${personaSystemFixed}`;

      const db = new Supermemory({ apiKey: config.supermemoryApiKey });
      const brainId = randomUUID();
      const space: Space = {
        name: `brain:${brainId}`,
        description: displayName,
      };

      const brainbase: BrainItem = {
        brainId,
        spaceName: space.name,
        displayName,
        language,
        baseSystemPrompt,
        dndReplyProbability: generated.dndReplyProbability,
        startConversationCountThreshold:
          generated.startConversationCountThreshold,
        startConversationTimeThreshold:
          generated.startConversationTimeThreshold,
        activated: false,
      };

      const memory = new Memory(db, space);

      await memory.add({
        customId: "persona",
        content: description,
        metadata: { kind: "persona", source: "persona-init" },
      });
      log.debug(`Brain.create: persona description stored`);

      await brainManager.saveBrain(brainId, brainbase);
      log.debug(`Brain.create: brainbase saved (id=${brainId})`);
      return { brainId, brain: new Brain(db, space, brainbase, memory) };
    } catch (error) {
      let reason =
        error instanceof Error
          ? `${error.message} (${error.name})`
          : String(error);
      if (error instanceof BadRequestResponseError) {
        reason = `${reason} ${JSON.stringify(error.body)}`;
      }
      log.debug(`Brain.create failed: ${reason}`);
      return { error: reason };
    }
  }

  static async delete(brainId: string): Promise<boolean> {
    log.debug(`Brain.delete: id=${brainId}`);
    const brainbase = await brainManager.loadBrain(brainId);
    if (!brainbase) {
      log.debug(`Brain.delete: no brainbase found`);
      return false;
    }

    const db = new Supermemory({ apiKey: config.supermemoryApiKey });
    const memory = new Memory(db, { name: brainbase.spaceName });
    try {
      await memory.clear();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Failed to clear memory for brain "${brainbase.displayName}": ${reason}`,
      );
    }

    await brainManager.deleteBrain(brainId);
    log.debug(`Brain.delete: done id=${brainId}`);
    return true;
  }

  static async load(brainId: string): Promise<Brain | null> {
    log.debug(`Brain.load: id=${brainId}`);
    const brainbase = await brainManager.loadBrain(brainId);
    if (!brainbase || !brainManager.isBrainReady(brainbase)) {
      log.debug(`Brain.load: not loadable (missing or not ready)`);
      return null;
    }

    const db = new Supermemory({ apiKey: config.supermemoryApiKey });
    const space: Space = { name: brainbase.spaceName };
    log.debug(`Brain.load: ready (channel=${brainbase.channel})`);
    return new Brain(db, space, brainbase);
  }
}

function formatDatetime(now: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function buildSendMessageTools(): ChatFunctionTool[] {
  return [
    {
      name: "addReplyMessage",
      description:
        "Append one chat bubble to the reply stream. Call once per bubble you want to send. After at least one successful call, you may end your turn without calling stop.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          content: { type: "string", description: "The bubble text." },
        },
        required: ["content"],
      },
    },
    {
      name: "searchMemory",
      description:
        "Semantic search over the long-term memory of facts about the persona and the user. Returns the most relevant stored content for a natural-language query.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description:
              "Natural-language query describing the fact you want to recall.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "stop",
      description:
        "End your turn without sending any further messages. Required when you choose not to send a message. Not needed once you have already called addReplyMessage at least once.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  ];
}

function parseAddReplyMessageArguments(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { content?: unknown };
    if (typeof parsed.content === "string" && parsed.content.length > 0) {
      return parsed.content;
    }
  } catch {
    return null;
  }
  return null;
}

function parseSearchArguments(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { query?: unknown };
    if (typeof parsed.query === "string" && parsed.query.trim().length > 0) {
      return parsed.query;
    }
  } catch {
    return null;
  }
  return null;
}

