import { randomUUID } from "node:crypto";
import Supermemory from "supermemory";
import { config } from "@/config";
import { llm } from "@/openrouter";
import { loadPrompt } from "@/openrouter/promptLoader";
import {
  availabilitySchema,
  dailyScheduleSchema,
  monthlyScheduleSchema,
  type AvailabilityWindows,
  type DailySchedule,
  type DailySlot,
  type MonthlySchedule,
} from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { BadRequestResponseError } from "@openrouter/sdk/models/errors";
import type {
  ChatAssistantMessage,
  ChatChoice,
  ChatFunctionTool,
  ChatMessages,
} from "@openrouter/sdk/models";
import { brainManager, type BrainItem } from "./manager";
import {
  translateMessageHistory,
  type MessageHistoryEntry,
} from "./messageHistory";
import {
  formatDateKey,
  formatMonthKey,
  nextDay,
  nextMonth,
  pad2,
} from "./schedule";
import type { Space } from "./types";
import { Memory } from "./memory";

export interface BrainCreateResult {
  brain: Brain;
  description: string;
  baseSystemPrompt: string;
}

export class Brain {
  private availabilityCache: Map<string, AvailabilityWindows> = new Map();

  constructor(
    private db: Supermemory,
    private space: Space,
    public brainbase: BrainItemWithChannel,
    public memory: Memory = new Memory(this.db, this.space),
  ) {}

  // ---------------------------------------------------------------------------
  // Domain methods
  // ---------------------------------------------------------------------------

  async createDailySchedule(
    datetime: Date,
    message: string,
  ): Promise<DailySchedule | null> {
    try {
      const target = nextDay(datetime);
      const dateKey = formatDateKey(target);
      const existing = await this.memory.get(`daily-schedule:${dateKey}`);
      if (existing) {
        try {
          return JSON.parse(existing.content) as DailySchedule;
        } catch {
          // fall through to regeneration if stored content is malformed
        }
      }

      const twoDaysAgo = new Date(target);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoKey = formatDateKey(twoDaysAgo);
      const [monthlySummary, history, twoDaysAgoStored] = await Promise.all([
        this.getMonthlySummaryForDay(target),
        this.getHistoryFacts(),
        this.memory.get(`daily-schedule:${twoDaysAgoKey}`),
      ]);
      let twoDaysAgoSchedule: DailySchedule | null = null;
      if (twoDaysAgoStored) {
        try {
          twoDaysAgoSchedule = JSON.parse(
            twoDaysAgoStored.content,
          ) as DailySchedule;
        } catch {
          twoDaysAgoSchedule = null;
        }
      }

      const instruction = await loadPrompt("DAILY_SCHEDULE");
      const promptMessage = [
        `Target date: ${dateKey} (${target.toLocaleDateString("en-US", { weekday: "long" })})`,
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
        `User direction: ${message}`,
      ].join("\n\n");

      const schedule = await llm.call<DailySchedule>(llm.models.identity, {
        instruction,
        message: promptMessage,
        jsonSchemaName: "daily-schedule",
        jsonSchema: dailyScheduleSchema,
      });

      await this.memory.add({
        customId: `daily-schedule:${dateKey}`,
        content: JSON.stringify(schedule),
        metadata: {
          kind: "schedule",
          source: "createDailySchedule",
          date: dateKey,
        },
      });

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

  async createMonthlySchedule(
    datetime: Date,
    message: string,
  ): Promise<MonthlySchedule | null> {
    try {
      const next = nextMonth(datetime);
      const monthKey = `${next.year}-${pad2(next.month + 1)}`;
      const existing = await this.memory.get(`monthly-schedule:${monthKey}`);
      if (existing) {
        try {
          return JSON.parse(existing.content) as MonthlySchedule;
        } catch {
          // fall through to regeneration if stored content is malformed
        }
      }

      const twoMonthsAgo = new Date(next.year, next.month - 2, 1);
      const twoMonthsAgoKey = `${twoMonthsAgo.getFullYear()}-${pad2(twoMonthsAgo.getMonth() + 1)}`;
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
        } catch {
          twoMonthsAgoSchedule = null;
        }
      }

      const instruction = await loadPrompt("MONTHLY_SCHEDULE");
      const promptMessage = [
        `Target month: ${monthKey} (${next.daysInMonth} days)`,
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
        `User direction: ${message}`,
      ].join("\n\n");

      const schedule = await llm.call<MonthlySchedule>(llm.models.identity, {
        instruction,
        message: promptMessage,
        jsonSchemaName: "monthly-schedule",
        jsonSchema: monthlyScheduleSchema,
      });

      await this.memory.add({
        customId: `monthly-schedule:${monthKey}`,
        content: JSON.stringify(schedule),
        metadata: {
          kind: "schedule",
          source: "createMonthlySchedule",
          month: monthKey,
        },
      });

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
    if (history.length === 0) return null;

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

      const memoir = await llm.call<string>(llm.models.identity, {
        instruction,
        message: promptMessage,
      });

      await this.memory.add({
        customId: `daily-journal:${dateKey}`,
        content: memoir,
        metadata: {
          kind: "daily-journal",
          source: "sleepMemory",
          date: dateKey,
        },
      });

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
    try {
      const dateKey = formatDateKey(datetime);
      const cached = this.availabilityCache.get(dateKey);
      if (cached) return cached;

      const stored = await this.memory.get(`daily-schedule:${dateKey}`);
      if (!stored) return null;

      const dailySchedule = JSON.parse(stored.content) as DailySchedule;
      const availability =
        await this.deriveAvailabilityFromSchedule(dailySchedule);

      this.availabilityCache.set(dateKey, availability);
      return availability;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`getTodayScheduledAvailability failed: ${reason}`);
      return null;
    }
  }

  async getCurrentAndAdjacentSlots(now: Date): Promise<DailySlot[]> {
    const dateKey = formatDateKey(now);
    const stored = await this.memory.get(`daily-schedule:${dateKey}`);
    if (!stored) return [];
    let schedule: DailySchedule;
    try {
      schedule = JSON.parse(stored.content) as DailySchedule;
    } catch {
      return [];
    }
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (hhmm: string): number => {
      const [h = 0, m = 0] = hhmm.split(":").map((x) => parseInt(x, 10));
      return h * 60 + m;
    };
    const index = schedule.items.findIndex(
      (slot) =>
        toMinutes(slot.start) <= currentMinutes &&
        currentMinutes < toMinutes(slot.end),
    );
    if (index === -1) return [];
    return schedule.items.slice(Math.max(0, index - 1), index + 2);
  }

  async deriveAvailabilityFromSchedule(
    schedule: DailySchedule,
  ): Promise<AvailabilityWindows> {
    try {
      const instruction = await loadPrompt("SCHEDULE_AVAILABILITY");
      const promptMessage = JSON.stringify({
        schedule,
        personality: this.brainbase.baseSystemPrompt,
      });

      return await llm.call<AvailabilityWindows>(llm.models.identity, {
        instruction,
        message: promptMessage,
        jsonSchemaName: "availability",
        jsonSchema: availabilitySchema,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`deriveAvailabilityFromSchedule failed: ${reason}`);
      throw error;
    }
  }

  invalidateScheduledAvailability(datetime: Date = new Date()): void {
    const todayKey = formatDateKey(datetime);
    for (const key of this.availabilityCache.keys()) {
      if (key < todayKey) {
        this.availabilityCache.delete(key);
      }
    }
  }

  async sendMessage(
    history: ReadonlyArray<MessageHistoryEntry>,
    newMessages: ReadonlyArray<MessageHistoryEntry>,
    options: { now?: Date; maxSteps?: number; initiate?: boolean } = {},
  ): Promise<string[]> {
    const now = options.now ?? new Date();
    const maxSteps = options.maxSteps ?? 8;
    const initiate = options.initiate ?? false;

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

    const instruction = initiate
      ? await loadPrompt("START_CONVERSATION")
      : await loadPrompt("SEND_MESSAGE");
    const userPrompt = initiate
      ? [
          `Current date and time: ${datetimeBlock}`,
          scheduleBlock,
          memoryBlock,
          `Conversation so far:`,
          historyBlock.length > 0 ? historyBlock : "(no prior messages)",
          `You are opening this chat. The user has not sent a message.`,
        ].join("\n\n")
      : [
          `Current date and time: ${datetimeBlock}`,
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

    for (let step = 0; step < maxSteps; step += 1) {
      let choice: ChatChoice;
      try {
        choice = await llm.chatWithTools(llm.models.conversation, {
          instruction: `${this.brainbase.baseSystemPrompt}\n\n${instruction}`,
          messages,
          tools,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(`sendMessage: LLM call failed at step ${step}: ${reason}`);
        return replyMessages;
      }

      const assistantMessage = choice.message;
      const toolCalls = assistantMessage.toolCalls ?? [];
      const hasContent =
        typeof assistantMessage.content === "string" &&
        assistantMessage.content.length > 0;

      if (toolCalls.length === 0) {
        return replyMessages;
      }

      messages.push(stripAssistantForHistory(assistantMessage));

      for (const call of toolCalls) {
        if (call.function.name === "addReplyMessage") {
          const content = parseAddReplyMessageArguments(
            call.function.arguments,
          );
          if (content !== null) replyMessages.push(content);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content:
              content === null
                ? JSON.stringify({ ok: false, error: "invalid arguments" })
                : JSON.stringify({ ok: true, index: replyMessages.length - 1 }),
          });
          continue;
        }
        if (call.function.name === "searchMemory") {
          const result = await this.executeSearchTool(call.function.arguments);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: result,
          });
          continue;
        }
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            error: `Unknown tool: ${call.function.name}`,
          }),
        });
      }

      if (
        !hasContent &&
        toolCalls.every((c) => c.function.name === "searchMemory")
      ) {
        continue;
      }
    }

    logger.warn(
      `sendMessage: reached maxSteps (${maxSteps}) without final reply`,
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
      return JSON.stringify({ ok: false, error: "missing query" });
    }
    try {
      const hits = await this.memory.search(query, 5);
      const compact = hits.map((hit) => ({
        content: hit.content,
        score: hit.score,
      }));
      return JSON.stringify({ ok: true, hits: compact });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ ok: false, error: reason });
    }
  }

  async getMonthlySummaryForDay(target: Date): Promise<string | null> {
    try {
      const monthKey = formatMonthKey(target);
      const stored = await this.memory.get(`monthly-schedule:${monthKey}`);
      if (!stored) return null;

      const monthly = JSON.parse(stored.content) as MonthlySchedule;
      const day = target.getDate();
      const entry = monthly.items.find((d) => d.day === day);
      return entry?.summary ?? null;
    } catch {
      return null;
    }
  }

  async getHistoryFacts(): Promise<string> {
    try {
      const docs = await this.memory.list();
      return docs
        .map((d) => d.content)
        .slice(-30)
        .join("\n");
    } catch {
      return "";
    }
  }

  static async create(
    displayName: string,
    seed: string,
  ): Promise<BrainCreateResult | null> {
    try {
      const personaInitInstruction = await loadPrompt("PERSONA_INIT");
      const description = await llm.call<string>(llm.models.identity, {
        instruction: personaInitInstruction,
        message: seed,
      });

      const personaSystemInstruction = await loadPrompt(
        "PERSONA_BASE_SYSTEM_PROMPT",
      );
      const generatedBaseSystemPrompt = await llm.call<string>(
        llm.models.identity,
        {
          instruction: personaSystemInstruction,
          message: description,
        },
      );

      const personaSystemFixed = await loadPrompt(
        "PERSONA_BASE_SYSTEM_PROMPT_FIXED",
      );
      const baseSystemPrompt = `${generatedBaseSystemPrompt}\n\n${personaSystemFixed}`;

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
        baseSystemPrompt,
        activated: true,
      };

      const memory = new Memory(db, space);

      await memory.add({
        customId: "persona",
        content: description,
        metadata: { kind: "persona", source: "persona-init" },
      });

      await brainManager.saveBrain(brainId, brainbase);

      return { brain, description, baseSystemPrompt };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create brain "${displayName}": ${reason}`);
      return null;
    }
  }

  static async load(brainId: string): Promise<Brain | null> {
    const brainbase = await brainManager.loadBrain(brainId);
    if (!brainbase) return null;

    const db = new Supermemory({ apiKey: config.supermemoryApiKey });
    const space: Space = { name: brainbase.spaceName };
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
      type: "function",
      function: {
        name: "addReplyMessage",
        description:
          "Append one chat bubble to the reply stream. Call once per bubble you want to send. Do not call when you are done — just return text without tool calls.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: { type: "string", description: "The bubble text." },
          },
          required: ["content"],
        },
      },
    },
    {
      type: "function",
      function: {
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

function stripAssistantForHistory(
  message: ChatAssistantMessage,
): ChatAssistantMessage {
  return {
    role: "assistant",
    content: message.content ?? null,
    toolCalls: message.toolCalls,
  };
}
