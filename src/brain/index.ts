import { randomUUID } from "node:crypto";
import { config } from "@/config";
import {
  IdentityDB,
  type EmbeddingProvider,
  type ExtractedFact,
  type Space,
} from "identitydb";
import { llm } from "@/openrouter";
import { OpenRouterEmbeddingProvider } from "@/openrouter/embedding";
import { loadPrompt } from "@/openrouter/promptLoader";
import {
  availabilitySchema,
  dailyScheduleSchema,
  monthlyScheduleSchema,
  type AvailabilityWindows,
  type DailySchedule,
  type MonthlySchedule,
} from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { factExtractor } from "./factExtractor";
import { BrainDBManager, brainManager, type BrainItem } from "./manager";
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
import { BadRequestResponseError } from "@openrouter/sdk/models/errors";
import type {
  ChatAssistantMessage,
  ChatChoice,
  ChatFunctionTool,
  ChatMessages,
} from "@openrouter/sdk/models";

export interface DebugOptions {
  personality: string;
}

export interface BrainCreateResult {
  brain: Brain;
  description: string;
  baseSystemPrompt: string;
  /**
   * Raw facts as returned by `factExtractor.extract(description)`. Populated
   * only when `Brain.create` is called with `debug: true`; in production
   * (the default), facts are persisted via `db.ingestStatements` which does
   * not surface the raw extractor output to the caller.
   */
  extractedFacts?: ExtractedFact[];
}

export class Brain {
  private availabilityCache: Map<string, AvailabilityWindows> = new Map();
  private embeddingProvider: EmbeddingProvider;

  constructor(
    public db: IdentityDB,
    public space: Space,
    public brainbase: BrainItem,
    public debug: boolean = false,
    embeddingProvider?: EmbeddingProvider,
  ) {
    this.embeddingProvider =
      embeddingProvider ?? new OpenRouterEmbeddingProvider();
  }

  async createDailySchedule(
    datetime: Date,
    message: string,
  ): Promise<DailySchedule | null> {
    try {
      const target = nextDay(datetime);
      const dateKey = formatDateKey(target);
      const topicName = `daily-schedule:${dateKey}`;

      const monthlySummary = await this.getMonthlySummaryForDay(target);
      const history = await this.getHistoryFacts();

      const instruction = await loadPrompt("DAILY_SCHEDULE");
      const promptMessage = [
        `Target date: ${dateKey} (${target.toLocaleDateString("en-US", { weekday: "long" })})`,
        `Personality: ${this.brainbase.baseSystemPrompt}`,
        monthlySummary
          ? `Monthly summary for this day: ${monthlySummary}`
          : "(no monthly summary available for this date)",
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

      if (!this.debug) {
        const fact = await this.db.addFact({
          spaceName: this.space.name,
          statement: JSON.stringify(schedule),
          summary: `Daily schedule for ${dateKey} (${schedule.items.length} slots)`,
          source: "createDailySchedule",
          confidence: 1.0,
          topics: [
            {
              name: topicName,
              category: "temporal",
              granularity: "concrete",
              role: "schedule",
            },
            {
              name: "daily-schedule",
              category: "concept",
              granularity: "abstract",
              role: "schedule",
            },
            {
              name: dateKey,
              category: "temporal",
              granularity: "concrete",
              role: "date",
            },
          ],
        });
        await this.indexFactEmbeddingFor(fact);
      }

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
      const topicName = `monthly-schedule:${monthKey}`;

      const history = await this.getHistoryFacts();

      const instruction = await loadPrompt("MONTHLY_SCHEDULE");
      const promptMessage = [
        `Target month: ${monthKey} (${next.daysInMonth} days)`,
        `Personality: ${this.brainbase.baseSystemPrompt}`,
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

      if (!this.debug) {
        const fact = await this.db.addFact({
          spaceName: this.space.name,
          statement: JSON.stringify(schedule),
          summary: `Monthly schedule for ${monthKey} (${schedule.items.length} days)`,
          source: "createMonthlySchedule",
          confidence: 1.0,
          topics: [
            {
              name: topicName,
              category: "temporal",
              granularity: "concrete",
              role: "schedule",
            },
            {
              name: "monthly-schedule",
              category: "concept",
              granularity: "abstract",
              role: "schedule",
            },
            {
              name: monthKey,
              category: "temporal",
              granularity: "concrete",
              role: "period",
            },
          ],
        });
        await this.indexFactEmbeddingFor(fact);
      }

      return schedule;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`createMonthlySchedule failed: ${reason}`);
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

      if (this.debug) {
        logger.warn(
          "getTodayScheduledAvailability requires a persisted daily schedule; debug brains have no DB. Use deriveAvailabilityFromSchedule(schedule) instead.",
        );
        return null;
      }

      const topicName = `daily-schedule:${dateKey}`;
      const facts = await this.db.getTopicFacts(topicName, {
        spaceName: this.space.name,
      });
      if (facts.length === 0) return null;

      const dailySchedule = JSON.parse(facts[0]!.statement) as DailySchedule;
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

  removeScheduledAvailability(): void {
    this.availabilityCache.clear();
  }

  /**
   * Embeds a single fact in the embedding table. Called automatically by
   * Brain methods that add facts (createDailySchedule, createMonthlySchedule,
   * Brain.create). Callers who add facts via `db.addFact` directly should
   * invoke this so the LLM can recall the fact via `searchIdentityDB`. A
   * no-op in debug mode (where there is no persisted state).
   */
  async indexFactEmbeddingFor(fact: { id: string }): Promise<void> {
    if (this.debug) return;
    try {
      await this.db.indexFactEmbedding(fact.id, {
        spaceName: this.space.name,
        provider: this.embeddingProvider,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(`indexFactEmbeddingFor(${fact.id}) failed: ${reason}`);
    }
  }

  /**
   * Backfills embeddings for every fact in this brain's space. Intended
   * for `Brain.create` and `Brain.load` — runs once at initialization so
   * facts added by older code paths (or out-of-band) become searchable.
   * No-op in debug mode and when the space has no facts.
   */
  async initializeEmbeddings(): Promise<void> {
    if (this.debug) return;
    try {
      await this.db.indexFactEmbeddings({
        spaceName: this.space.name,
        provider: this.embeddingProvider,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(`initializeEmbeddings failed: ${reason}`);
    }
  }

  async sendMessage(
    history: ReadonlyArray<MessageHistoryEntry>,
    newMessages: ReadonlyArray<MessageHistoryEntry>,
    options: { now?: Date; maxSteps?: number } = {},
  ): Promise<string[]> {
    const now = options.now ?? new Date();
    const maxSteps = options.maxSteps ?? 8;

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

    const instruction = await loadPrompt("SEND_MESSAGE");
    const userPrompt = [
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
        if (call.function.name === "searchIdentityDB") {
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
        toolCalls.every((c) => c.function.name === "searchIdentityDB")
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
    const days: { label: string; date: Date }[] = [
      {
        label: "Yesterday",
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
      },
      { label: "Today", date: now },
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
    return `Schedule context:\n${blocks.join("\n")}`;
  }

  private async getDailyScheduleSummary(
    dateKey: string,
  ): Promise<string | null> {
    if (this.debug) return null;
    try {
      const facts = await this.db.getTopicFacts(`daily-schedule:${dateKey}`, {
        spaceName: this.space.name,
      });
      if (facts.length === 0) return null;
      const schedule = JSON.parse(facts[0]!.statement) as DailySchedule;
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
      const hits = await this.db.searchFacts({
        spaceName: this.space.name,
        query,
        provider: this.embeddingProvider,
        limit: 5,
      });
      const compact = hits.map((hit) => ({
        statement: hit.statement,
        summary: hit.summary,
        score: hit.score,
      }));
      return JSON.stringify({ ok: true, hits: compact });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ ok: false, error: reason });
    }
  }

  private async getMonthlySummaryForDay(target: Date): Promise<string | null> {
    if (this.debug) return null;
    try {
      const monthKey = formatMonthKey(target);
      const topicName = `monthly-schedule:${monthKey}`;
      const facts = await this.db.getTopicFacts(topicName, {
        spaceName: this.space.name,
      });
      if (facts.length === 0) return null;

      const monthly = JSON.parse(facts[0]!.statement) as MonthlySchedule;
      const day = target.getDate();
      const entry = monthly.items.find((d) => d.day === day);
      return entry?.summary ?? null;
    } catch {
      return null;
    }
  }

  private async getHistoryFacts(): Promise<string> {
    if (this.debug) return "";
    try {
      const topics = await this.db.listTopics({
        spaceName: this.space.name,
        includeFacts: true,
      });
      const statements: string[] = [];
      for (const topic of topics) {
        const t = topic as { facts?: Array<{ statement: string }> };
        if (t.facts) {
          for (const f of t.facts) statements.push(f.statement);
        }
      }
      return statements.slice(-30).join("\n");
    } catch {
      return "";
    }
  }

  static async create(
    displayName: string,
    seed: string,
    options: {
      dbPath?: string;
      braindbPath?: string;
      debug?: boolean;
      embeddingProvider?: EmbeddingProvider;
    } = {},
  ): Promise<BrainCreateResult | null> {
    const dbPath = options.dbPath ?? config.dbPath;
    const manager = options.braindbPath
      ? new BrainDBManager(options.braindbPath)
      : brainManager;
    const embeddingProvider =
      options.embeddingProvider ?? new OpenRouterEmbeddingProvider();
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

      const db = await IdentityDB.connect({
        client: "sqlite",
        filename: dbPath,
      });
      await db.initialize();
      const brainId = randomUUID();
      const spaceName = `brain:${brainId}`;
      const space = await db.upsertSpace({
        name: spaceName,
        description: displayName,
      });

      let extractedFacts: ExtractedFact[] | undefined;
      if (options.debug) {
        extractedFacts = await factExtractor.extract(description);
        for (const fact of extractedFacts) {
          const created = await db.addFact({
            spaceName,
            statement: fact.statement ?? description,
            summary: fact.summary,
            source: fact.source,
            confidence: fact.confidence,
            topics: fact.topics,
            metadata: fact.metadata,
          });
          await db.indexFactEmbedding(created.id, {
            spaceName,
            provider: embeddingProvider,
          });
        }
      } else {
        await db.ingestStatements(description, {
          extractor: factExtractor,
          embeddingProvider,
          spaceName,
        });
      }

      const brainbase: BrainItem = {
        brainId,
        spaceName,
        displayName,
        baseSystemPrompt,
      };
      await manager.saveBrain(brainId, brainbase);

      const brain = new Brain(db, space, brainbase, false, embeddingProvider);
      return { brain, description, baseSystemPrompt, extractedFacts };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create brain "${displayName}": ${reason}`);
      return null;
    }
  }

  static async load(brainId: string): Promise<Brain | null> {
    const brain = await brainManager.loadBrain(brainId);
    if (!brain) return null;

    const db = await IdentityDB.connect({
      client: "sqlite",
      filename: config.dbPath,
    });

    const space = await db.getSpaceByName(brain.spaceName);
    if (!space) return null;

    const brainInstance = new Brain(db, space, brain);
    await brainInstance.initializeEmbeddings();
    return brainInstance;
  }

  static async createDebug(options: DebugOptions): Promise<Brain> {
    const db = await IdentityDB.connect({
      client: "sqlite",
      filename: ":memory:",
    });
    await db.initialize();
    const space = await db.upsertSpace({
      name: "debug",
      description: "Debug Brain",
    });

    const brainbase: BrainItem = {
      brainId: "debug",
      spaceName: "debug",
      displayName: "Debug Brain",
      baseSystemPrompt: options.personality,
    };

    return new Brain(db, space, brainbase, true);
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
        name: "searchIdentityDB",
        description:
          "Semantic search over the long-term memory of facts about the persona and the user. Returns the most relevant stored statements for a natural-language query.",
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
