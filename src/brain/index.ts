import { randomUUID } from "node:crypto";
import { config } from "@/config";
import { IdentityDB, type ExtractedFact, type Space } from "identitydb";
import { llm } from "@/openrouter";
import { loadPrompt } from "@/openrouter/promptLoader";
import {
  availabilitySchema,
  dailyScheduleSchema,
  monthlyScheduleSchema,
  type Availability,
  type AvailabilityWindows,
  type DailySchedule,
  type MonthlySchedule,
} from "@/openrouter/schema";
import { logger } from "@/utils/logger";
import { factExtractor } from "./factExtractor";
import { BrainDBManager, brainManager, type BrainItem } from "./manager";
import {
  formatDateKey,
  formatMonthKey,
  nextDay,
  nextMonth,
  pad2,
} from "./schedule";
import { BadRequestResponseError } from "@openrouter/sdk/models/errors";

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

  constructor(
    public db: IdentityDB,
    public space: Space,
    public brainbase: BrainItem,
    public debug: boolean = false,
  ) {}

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
        await this.db.addFact({
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
        await this.db.addFact({
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
    options: { dbPath?: string; braindbPath?: string; debug?: boolean } = {},
  ): Promise<BrainCreateResult | null> {
    const dbPath = options.dbPath ?? config.dbPath;
    const manager = options.braindbPath
      ? new BrainDBManager(options.braindbPath)
      : brainManager;
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
          await db.addFact({
            spaceName,
            statement: fact.statement ?? description,
            summary: fact.summary,
            source: fact.source,
            confidence: fact.confidence,
            topics: fact.topics,
            metadata: fact.metadata,
          });
        }
      } else {
        await db.ingestStatements(description, {
          extractor: factExtractor,
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

      const brain = new Brain(db, space, brainbase);
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

    return new Brain(db, space, brain);
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
