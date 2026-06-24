import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import type { Space } from "./types";

const llmCalls: Array<{ model: unknown; options: any }> = [];
let customMonthlyDays: Array<{ day: number; summary: string }> | null = null;
let customDailySlots: Array<{
  start: string;
  end: string;
  activity: string;
  notes: string;
}> | null = null;
let customAvailability: Array<{
  start: string;
  end: string;
  status: string;
}> | null = null;

type ToolCallResponse = {
  id: string;
  name: string;
  arguments: string;
};
type LLMChatResponse =
  | { kind: "text"; text: string }
  | { kind: "tool_calls"; tool_calls: ToolCallResponse[] };
let chatResponses: LLMChatResponse[] = [];

function build48Slots(): Array<{
  start: string;
  end: string;
  activity: string;
  notes: string;
}> {
  const slots: Array<{
    start: string;
    end: string;
    activity: string;
    notes: string;
  }> = [];
  for (let i = 0; i < 48; i++) {
    const startHour = Math.floor(i / 2);
    const startMin = (i % 2) * 30;
    const start = `${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")}`;
    let end: string;
    if (i === 47) {
      end = "24:00";
    } else {
      const endHour = Math.floor((i + 1) / 2);
      const endMin = ((i + 1) % 2) * 30;
      end = `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;
    }
    slots.push({ start, end, activity: `slot-${i}`, notes: "" });
  }
  return slots;
}

function build30Days(): Array<{ day: number; summary: string }> {
  return Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    summary: `Day ${i + 1} summary`,
  }));
}

function buildAvailability(): Array<{
  start: string;
  end: string;
  status: string;
}> {
  return [
    { start: "00:00", end: "07:00", status: "offline" },
    { start: "07:00", end: "09:00", status: "online" },
    { start: "09:00", end: "17:00", status: "do-not-disturb" },
    { start: "17:00", end: "23:30", status: "online" },
    { start: "23:30", end: "24:00", status: "offline" },
  ];
}

const mockCall = mock(async <T>(model: unknown, options: any): Promise<T> => {
  llmCalls.push({ model, options });
  if (options.jsonSchemaName === "daily-schedule") {
    return { items: customDailySlots ?? build48Slots() } as unknown as T;
  }
  if (options.jsonSchemaName === "monthly-schedule") {
    if (customMonthlyDays) {
      return { items: customMonthlyDays } as unknown as T;
    }
    const match = options.message.match(/\((\d+) days\)/);
    const days = match ? parseInt(match[1]!, 10) : 30;
    return {
      items: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        summary: `Day ${i + 1} summary`,
      })),
    } as unknown as T;
  }
  if (options.jsonSchemaName === "availability") {
    return { items: customAvailability ?? buildAvailability() } as unknown as T;
  }
  if (Array.isArray(options.tools)) {
    const next = chatResponses.shift();
    if (!next) {
      throw new Error("mockCall: no chatResponses queued for tool-using call");
    }
    if (next.kind === "text") {
      return {
        finish_reason: "stop",
        index: 0,
        message: { role: "assistant", content: next.text },
      } as unknown as T;
    }
    return {
      finish_reason: "tool_calls",
      index: 0,
      message: {
        role: "assistant",
        content: null,
        toolCalls: next.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      },
    } as unknown as T;
  }
  if (typeof options.message === "string" || options.message === undefined) {
    return "test-description" as unknown as T;
  }
  throw new Error(`unexpected jsonSchemaName: ${options.jsonSchemaName}`);
});

mock.module("@/openrouter", () => ({
  llm: {
    models: { conversation: "test-conv", identity: "test-id" },
    call: mockCall,
    chatWithTools: mockCall,
  },
}));

mock.module("@/config", () => ({
  config: {
    openrouterApiKey: "test-key",
    supermemoryApiKey: "test-supermemory-key",
    braindbPath: "/tmp/brainbox-test-braindb.json",
  },
}));

interface StoredDoc {
  id: string;
  customId: string | null;
  containerTag: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
}

class MockSupermemory {
  docs = new Map<string, StoredDoc>();
  private nextId = 0;
  documentsAddCalls = 0;

  constructor(_options: { apiKey: string }) {}

  documents = {
    add: async (params: {
      content: string;
      containerTag: string;
      customId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      this.documentsAddCalls += 1;
      const id = `mock-${++this.nextId}`;
      const stored: StoredDoc = {
        id,
        customId: params.customId ?? null,
        containerTag: params.containerTag,
        content: params.content,
        summary: null,
        metadata: params.metadata ?? null,
      };
      this.docs.set(id, stored);
      return { id, status: "done" };
    },
    list: async (params: {
      containerTags?: Array<string>;
      limit?: number;
    }) => {
      const tags = params.containerTags ?? [];
      const limit = params.limit ?? 200;
      const all = Array.from(this.docs.values()).filter((d) =>
        tags.length === 0 ? true : tags.includes(d.containerTag),
      );
      const memories = all.slice(0, limit).map((d) => ({
        id: d.id,
        customId: d.customId,
        containerTag: d.containerTag,
        summary: d.summary,
        metadata: d.metadata as
          | string
          | number
          | boolean
          | Record<string, unknown>
          | Array<unknown>
          | null,
        content: d.content,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        status: "done" as const,
        type: "text" as const,
        connectionId: null,
        filepath: null,
        title: null,
      }));
      return {
        memories,
        pagination: {
          currentPage: 1,
          totalItems: memories.length,
          totalPages: 1,
          limit,
        },
      };
    },
    get: async (id: string) => {
      const d = this.docs.get(id);
      if (!d) {
        throw new Error(`MockSupermemory.documents.get: no such id ${id}`);
      }
      return {
        id: d.id,
        customId: d.customId,
        containerTag: d.containerTag,
        content: d.content,
        summary: d.summary,
        metadata: d.metadata as
          | string
          | number
          | boolean
          | Record<string, unknown>
          | Array<unknown>
          | null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        status: "done" as const,
        type: "text" as const,
        connectionId: null,
        filepath: null,
        title: null,
        source: null,
        ogImage: null,
        raw: null,
        spatialPoint: null,
        taskType: "memory" as const,
        url: null,
      };
    },
  };

  search = {
    execute: async (params: {
      q: string;
      containerTag?: string;
      limit?: number;
      onlyMatchingChunks?: boolean;
    }) => {
      const q = params.q.toLowerCase();
      const limit = params.limit ?? 5;
      const hits = Array.from(this.docs.values())
        .filter(
          (d) =>
            (params.containerTag
              ? d.containerTag === params.containerTag
              : true) && d.content.toLowerCase().includes(q),
        )
        .slice(0, limit)
        .map((d, i) => ({
          chunks: [
            {
              content: d.content,
              isRelevant: true,
              score: 1 - i * 0.1,
            },
          ],
          summary: d.summary,
          score: 1 - i * 0.1,
          documentId: d.id,
          metadata: (d.metadata as Record<string, unknown>) ?? null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          title: d.customId,
          type: "text" as const,
        }));
      return {
        results: hits,
        total: hits.length,
        timing: 0,
      };
    },
  };

  findByCustomId(customId: string): StoredDoc | undefined {
    for (const d of this.docs.values()) {
      if (d.customId === customId) return d;
    }
    return undefined;
  }

  reset(): void {
    this.docs.clear();
    this.nextId = 0;
    this.documentsAddCalls = 0;
  }
}

/**
 * Replace the real `supermemory` SDK with our in-memory mock. The
 * static factories `Brain.create` / `Brain.createDebug` / `Brain.load`
 * all do `new Supermemory({ apiKey })` internally; this mock is what
 * they pick up.
 */
mock.module("supermemory", () => ({
  default: MockSupermemory,
}));

const { Brain } = await import("./index");
const { brainManager } = await import("./manager");
const { formatDateKey, nextMonth } = await import("./schedule");
type BrainItem = import("./manager").BrainItem;

beforeAll(async () => {
  try {
    await brainManager.deleteBrain("smoke-test-id");
  } catch {}
});

afterAll(async () => {});

async function makeBrain(): Promise<InstanceType<typeof Brain>> {
  const db = new MockSupermemory({ apiKey: "test-supermemory-key" });
  const spaceName = `test-space-${randomUUID()}`;
  const space: Space = { name: spaceName, description: "Test Brain space" };
  const brainbase: BrainItem = {
    brainId: randomUUID(),
    spaceName,
    displayName: "Test Brain",
    baseSystemPrompt:
      "Test personality: night owl, introverted, studies at midnight.",
  };
  return new Brain(db as never, space, brainbase, false);
}

beforeEach(() => {
  llmCalls.length = 0;
  customMonthlyDays = null;
  customDailySlots = null;
  customAvailability = null;
  chatResponses = [];
});

describe("Brain.createDailySchedule", () => {
  test("S1: returns 48 slots in 30-min intervals and persists a document", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;
    const today = new Date(2026, 5, 5);
    const expectedTomorrow = (await import("./schedule")).nextDay(today);
    const expectedKey = formatDateKey(expectedTomorrow);

    const result = await brain.createDailySchedule(today, "focus on writing");

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(48);
    expect(result!.items[0]).toEqual({
      start: "00:00",
      end: "00:30",
      activity: "slot-0",
      notes: "",
    });
    expect(result!.items[47]).toEqual({
      start: "23:30",
      end: "24:00",
      activity: "slot-47",
      notes: "",
    });

    const llmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "daily-schedule",
    );
    expect(llmCall).toBeDefined();
    expect(llmCall!.options.message).toContain(expectedKey);
    expect(llmCall!.options.message).toContain("focus on writing");
    expect(llmCall!.options.message).toContain("Test personality");

    const stored = db.findByCustomId(`daily-schedule:${expectedKey}`);
    expect(stored).toBeDefined();
    expect(stored!.containerTag).toBe(brain.space.name);
    expect(JSON.parse(stored!.content).items).toHaveLength(48);
  });

  test("S4: month wrap (June 30 -> July 1)", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;
    const today = new Date(2026, 5, 30);
    const expectedKey = formatDateKey(new Date(2026, 6, 1));

    await brain.createDailySchedule(today, "");

    const stored = db.findByCustomId(`daily-schedule:${expectedKey}`);
    expect(stored).toBeDefined();
  });

  test("S4b: year wrap (December 31 -> January 1 next year)", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;
    const today = new Date(2026, 11, 31);
    const expectedKey = "2027-01-01";

    await brain.createDailySchedule(today, "");

    const stored = db.findByCustomId(`daily-schedule:${expectedKey}`);
    expect(stored).toBeDefined();
  });

  test("S6: consumes monthly summary for the target day when present", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;

    customMonthlyDays = Array.from({ length: 30 }, (_, i) => ({
      day: i + 1,
      summary:
        i + 1 === 10 ? "UNIQUE_SUMMARY_FOR_DAY_10" : `Day ${i + 1} summary`,
    }));

    const todayForMonthly = new Date(2026, 4, 15);
    await brain.createMonthlySchedule(todayForMonthly, "");

    const monthlyStored = db.findByCustomId("monthly-schedule:2026-06");
    expect(monthlyStored).toBeDefined();

    llmCalls.length = 0;
    customDailySlots = build48Slots();

    const todayForDaily = new Date(2026, 5, 9);
    await brain.createDailySchedule(todayForDaily, "");

    const dailyLlmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "daily-schedule",
    );
    expect(dailyLlmCall).toBeDefined();
    expect(dailyLlmCall!.options.message).toContain(
      "UNIQUE_SUMMARY_FOR_DAY_10",
    );
  });

  test("S9: injects 2-days-ago schedule as recent context when one exists", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;

    const twoDaysAgoTarget = new Date(2026, 5, 7);
    const twoDaysAgoTomorrow = (await import("./schedule")).nextDay(
      twoDaysAgoTarget,
    );
    const twoDaysAgoKey = formatDateKey(twoDaysAgoTomorrow);

    await brain.add({
      customId: `daily-schedule:${twoDaysAgoKey}`,
      content: JSON.stringify({
        items: Array.from({ length: 48 }, (_, i) => ({
          start: `${String(Math.floor(i / 2)).padStart(2, "0")}:${String((i % 2) * 30).padStart(2, "0")}`,
          end: `${String(Math.floor((i + 1) / 2)).padStart(2, "0")}:${String(((i + 1) % 2) * 30).padStart(2, "0")}`,
          activity: `prior-day-activity-${i}`,
          notes: "",
        })),
      }),
      metadata: { kind: "schedule", source: "createDailySchedule", date: twoDaysAgoKey },
    });

    llmCalls.length = 0;
    const today = new Date(2026, 5, 9);
    await brain.createDailySchedule(today, "");

    const dailyLlmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "daily-schedule",
    );
    expect(dailyLlmCall).toBeDefined();
    expect(dailyLlmCall!.options.message).toContain(
      `Recent schedule (${twoDaysAgoKey}, 2 days ago):`,
    );
    expect(dailyLlmCall!.options.message).toContain("prior-day-activity-0");
  });

  test("S10: 2-days-ago context says 'no schedule on file' when prior day is missing", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 9);
    await brain.createDailySchedule(today, "");

    const dailyLlmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "daily-schedule",
    );
    expect(dailyLlmCall).toBeDefined();
    expect(dailyLlmCall!.options.message).toContain(
      "(no schedule on file for 2 days ago)",
    );
  });
});

describe("Brain.createMonthlySchedule", () => {
  test("S2: returns N day summaries (N = days in next month) and persists a document", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;
    const today = new Date(2026, 0, 15);
    const expected = nextMonth(today);
    const expectedKey = `${expected.year}-${String(expected.month + 1).padStart(2, "0")}`;

    const result = await brain.createMonthlySchedule(today, "study for GRE");

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(expected.daysInMonth);
    expect(result!.items[0]!.day).toBe(1);
    expect(result!.items[result!.items.length - 1]!.day).toBe(
      expected.daysInMonth,
    );

    const llmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "monthly-schedule",
    );
    expect(llmCall).toBeDefined();
    expect(llmCall!.options.message).toContain("study for GRE");
    expect(llmCall!.options.message).toContain("Test personality");

    const stored = db.findByCustomId(`monthly-schedule:${expectedKey}`);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!.content).items).toHaveLength(
      expected.daysInMonth,
    );
  });

  test("S5: year wrap (December 15 -> January next year)", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;
    const today = new Date(2026, 11, 15);
    const expectedKey = "2027-01";

    const result = await brain.createMonthlySchedule(today, "");

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(31);

    const stored = db.findByCustomId(`monthly-schedule:${expectedKey}`);
    expect(stored).toBeDefined();
  });
});

describe("Brain.createDailySchedule early return", () => {
  test("returns existing schedule without calling LLM when daily-schedule for tomorrow already exists", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 9);
    const tomorrow = (await import("./schedule")).nextDay(today);
    const tomorrowKey = formatDateKey(tomorrow);
    const preseeded = {
      items: [
        {
          start: "06:00",
          end: "07:00",
          activity: "preserved-morning",
          notes: "n/a",
        },
        {
          start: "22:00",
          end: "23:00",
          activity: "preserved-evening",
          notes: "n/a",
        },
      ],
    };
    await brain.add({
      customId: `daily-schedule:${tomorrowKey}`,
      content: JSON.stringify(preseeded),
      metadata: { kind: "schedule", source: "test-seed", date: tomorrowKey },
    });

    llmCalls.length = 0;
    const result = await brain.createDailySchedule(today, "ignored user message");

    expect(result).toEqual(preseeded);
    const dailyLlmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "daily-schedule",
    );
    expect(dailyLlmCall).toBeUndefined();
  });

  test("falls through to generation when stored content is malformed", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;
    const today = new Date(2026, 5, 9);
    const tomorrow = (await import("./schedule")).nextDay(today);
    const tomorrowKey = formatDateKey(tomorrow);
    await brain.add({
      customId: `daily-schedule:${tomorrowKey}`,
      content: "{not valid json",
      metadata: { kind: "schedule", source: "test-seed", date: tomorrowKey },
    });

    const result = await brain.createDailySchedule(today, "");

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(48);
    const dailyLlmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "daily-schedule",
    );
    expect(dailyLlmCall).toBeDefined();
    expect(db.findByCustomId(`daily-schedule:${tomorrowKey}`)).toBeDefined();
  });
});

describe("Brain.createMonthlySchedule early return", () => {
  test("returns existing schedule without calling LLM when monthly-schedule for next month already exists", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 0, 15);
    const next = nextMonth(today);
    const monthKey = `${next.year}-${String(next.month + 1).padStart(2, "0")}`;
    const preseeded = {
      items: [
        { day: 1, summary: "preserved-day-1" },
        { day: 2, summary: "preserved-day-2" },
        { day: 3, summary: "preserved-day-3" },
      ],
    };
    await brain.add({
      customId: `monthly-schedule:${monthKey}`,
      content: JSON.stringify(preseeded),
      metadata: { kind: "schedule", source: "test-seed", month: monthKey },
    });

    llmCalls.length = 0;
    const result = await brain.createMonthlySchedule(today, "ignored user message");

    expect(result).toEqual(preseeded);
    const monthlyLlmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "monthly-schedule",
    );
    expect(monthlyLlmCall).toBeUndefined();
  });

  test("falls through to generation when stored content is malformed", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 0, 15);
    const next = nextMonth(today);
    const monthKey = `${next.year}-${String(next.month + 1).padStart(2, "0")}`;
    await brain.add({
      customId: `monthly-schedule:${monthKey}`,
      content: "{not valid json",
      metadata: { kind: "schedule", source: "test-seed", month: monthKey },
    });

    const result = await brain.createMonthlySchedule(today, "");

    expect(result).not.toBeNull();
    const monthlyLlmCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "monthly-schedule",
    );
    expect(monthlyLlmCall).toBeDefined();
  });
});

describe("Brain.getTodayScheduledAvailability", () => {
  test("S3: returns availability windows when today's daily schedule exists", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 10);
    const todayKey = formatDateKey(today);
    await brain.add({
      customId: `daily-schedule:${todayKey}`,
      content: JSON.stringify({ items: build48Slots() }),
      metadata: {
        kind: "schedule",
        source: "test",
        date: todayKey,
      },
    });

    const result = await brain.getTodayScheduledAvailability(today);

    expect(result).not.toBeNull();
    expect(result!.items.length).toBeGreaterThan(0);
    for (const w of result!.items) {
      expect(["online", "do-not-disturb", "offline"]).toContain(w.status);
      expect(w.start).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
      expect(w.end).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/);
    }

    const availabilityCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "availability",
    );
    expect(availabilityCall).toBeDefined();
  });

  test("returns null when no daily schedule exists for today", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 10);
    const result = await brain.getTodayScheduledAvailability(today);
    expect(result).toBeNull();
    expect(llmCalls).toHaveLength(0);
  });
});

describe("Brain.invalidateScheduledAvailability", () => {
  test("S7a: today's cached availability is preserved after invalidateScheduledAvailability()", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 10);
    const todayKey = formatDateKey(today);
    await brain.add({
      customId: `daily-schedule:${todayKey}`,
      content: JSON.stringify({ items: build48Slots() }),
      metadata: {
        kind: "schedule",
        source: "test",
        date: todayKey,
      },
    });

    const r1 = await brain.getTodayScheduledAvailability(today);
    expect(r1).not.toBeNull();
    const callCountAfterFirst = llmCalls.length;
    expect(callCountAfterFirst).toBe(1);

    const r2 = await brain.getTodayScheduledAvailability(today);
    expect(r2).not.toBeNull();
    expect(llmCalls.length).toBe(callCountAfterFirst);

    brain.invalidateScheduledAvailability(today);

    const r3 = await brain.getTodayScheduledAvailability(today);
    expect(r3).not.toBeNull();
    expect(llmCalls.length).toBe(callCountAfterFirst);
  });

  test("S7b: previous days' cached availability is removed, today/future preserved", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 10);
    const todayKey = formatDateKey(today);
    const yesterday = new Date(2026, 5, 9);
    const yesterdayKey = formatDateKey(yesterday);
    const tomorrow = new Date(2026, 5, 11);
    const tomorrowKey = formatDateKey(tomorrow);
    const slots = { items: build48Slots() };
    for (const key of [yesterdayKey, todayKey, tomorrowKey]) {
      await brain.add({
        customId: `daily-schedule:${key}`,
        content: JSON.stringify(slots),
        metadata: { kind: "schedule", source: "test", date: key },
      });
    }

    await brain.getTodayScheduledAvailability(yesterday);
    await brain.getTodayScheduledAvailability(today);
    await brain.getTodayScheduledAvailability(tomorrow);

    const beforeInvalidate = llmCalls.length;
    await brain.getTodayScheduledAvailability(today);
    await brain.getTodayScheduledAvailability(tomorrow);
    expect(llmCalls.length).toBe(beforeInvalidate);

    brain.invalidateScheduledAvailability(today);

    const afterToday = llmCalls.length;
    await brain.getTodayScheduledAvailability(today);
    expect(llmCalls.length).toBe(afterToday);

    await brain.getTodayScheduledAvailability(tomorrow);
    expect(llmCalls.length).toBe(afterToday);

    await brain.getTodayScheduledAvailability(yesterday);
    expect(llmCalls.length).toBe(afterToday + 1);
  });
});

describe("S8: regression on existing methods", () => {
  test("Brain.create and Brain.load are still defined as static methods", () => {
    expect(typeof Brain.create).toBe("function");
    expect(typeof Brain.load).toBe("function");
  });
});

describe("Brain.createDebug", () => {
  test("D1: returns a Brain with debug=true and the supplied personality under the brain:debug namespace", async () => {
    const brain = await Brain.createDebug({ personality: "test-personality-Q" });

    expect(brain).toBeInstanceOf(Brain);
    expect(brain.debug).toBe(true);
    expect(brain.brainbase.baseSystemPrompt).toBe("test-personality-Q");
    expect(brain.brainbase.displayName).toBe("Debug Brain");
    expect(brain.space.name).toBe("brain:debug");
  });

  test("D2: createDailySchedule on a debug brain returns a schedule and persists to brain:debug", async () => {
    const brain = await Brain.createDebug({ personality: "p" });
    const db = brain.db as unknown as MockSupermemory;
    const today = new Date(2026, 5, 5);
    const tomorrow = new Date(2026, 5, 6);
    const tomorrowKey = formatDateKey(tomorrow);

    const schedule = await brain.createDailySchedule(today, "msg");
    expect(schedule).not.toBeNull();
    expect(schedule!.items).toHaveLength(48);

    const stored = db.findByCustomId(`daily-schedule:${tomorrowKey}`);
    expect(stored).toBeDefined();
    expect(stored!.containerTag).toBe("brain:debug");
  });

  test("D3: createMonthlySchedule on a debug brain returns a schedule and persists to brain:debug", async () => {
    const brain = await Brain.createDebug({ personality: "p" });
    const db = brain.db as unknown as MockSupermemory;
    const today = new Date(2026, 0, 15);
    const expected = nextMonth(today);
    const monthKey = `${expected.year}-${String(expected.month + 1).padStart(2, "0")}`;

    const schedule = await brain.createMonthlySchedule(today, "msg");
    expect(schedule).not.toBeNull();
    expect(schedule!.items).toHaveLength(expected.daysInMonth);

    const stored = db.findByCustomId(`monthly-schedule:${monthKey}`);
    expect(stored).toBeDefined();
    expect(stored!.containerTag).toBe("brain:debug");
  });
});

describe("Brain.sendMessage — translateMessageHistory helper", () => {
  test("SM1: translateMessageHistory produces the documented format with persona label and timestamps", async () => {
    const { translateMessageHistory } = await import("./messageHistory");
    const t1 = new Date(2026, 5, 10, 9, 30, 0);
    const t2 = new Date(2026, 5, 10, 9, 31, 0);
    const t3 = new Date(2026, 5, 10, 9, 32, 0);
    const out = translateMessageHistory("Mika", [
      { sender: "persona", time: t1, content: "다음에 보자" },
      { sender: "user", time: t2, content: "그래" },
      { sender: "user", time: t3, content: "지금 뭐해?" },
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.startsWith("Mika@")).toBe(true);
    expect(lines[0]!.endsWith(": 다음에 보자")).toBe(true);
    expect(lines[1]!.startsWith("사용자@")).toBe(true);
    expect(lines[1]!.endsWith(": 그래")).toBe(true);
    expect(lines[2]!.startsWith("사용자@")).toBe(true);
    expect(lines[2]!.endsWith(": 지금 뭐해?")).toBe(true);
  });

  test("SM2: translateMessageHistory returns empty string for empty history", async () => {
    const { translateMessageHistory } = await import("./messageHistory");
    expect(translateMessageHistory("Mika", [])).toBe("");
  });
});

describe("Brain.sendMessage — tool-calling flow", () => {
  test("SM3: sendMessage returns the LLM's final text when no tools are called", async () => {
    const brain = await makeBrain();
    chatResponses = [
      {
        kind: "tool_calls",
        tool_calls: [
          {
            id: "call_r1",
            name: "addReplyMessage",
            arguments: JSON.stringify({ content: "안녕!" }),
          },
        ],
      },
      { kind: "text", text: "(end)" },
    ];
    const out = await brain.sendMessage(
      [{ sender: "user", time: new Date(2026, 5, 10, 9, 0, 0), content: "안녕" }],
      [],
    );
    expect(out).toEqual(["안녕!"]);
    const toolsCall = llmCalls.find(
      (c) => Array.isArray(c.options.tools) && c.options.tools.length > 0,
    );
    expect(toolsCall).toBeDefined();
    const toolNames = (
      toolsCall!.options.tools as Array<{
        function: { name: string };
      }>
    ).map((t) => t.function.name);
    expect(toolNames).toContain("addReplyMessage");
    expect(toolNames).toContain("searchMemory");
  });

  test("SM4: sendMessage accumulates addReplyMessage tool calls and returns them in order", async () => {
    const brain = await makeBrain();
    chatResponses = [
      {
        kind: "tool_calls",
        tool_calls: [
          {
            id: "call_1",
            name: "addReplyMessage",
            arguments: JSON.stringify({ content: "어." }),
          },
        ],
      },
      {
        kind: "tool_calls",
        tool_calls: [
          {
            id: "call_2",
            name: "addReplyMessage",
            arguments: JSON.stringify({ content: "왜불러" }),
          },
        ],
      },
      { kind: "text", text: "(end)" },
    ];
    const out = await brain.sendMessage(
      [{ sender: "user", time: new Date(2026, 5, 10, 9, 0, 0), content: "야" }],
      [],
    );
    expect(out).toEqual(["어.", "왜불러"]);
  });

  test("SM5: sendMessage feeds searchMemory tool result back to the LLM", async () => {
    const brain = await makeBrain();
    await brain.add({
      customId: "fact-coffee",
      content: "사용자는 커피를 좋아한다",
      metadata: { kind: "fact", source: "test" },
    });

    chatResponses = [
      {
        kind: "tool_calls",
        tool_calls: [
          {
            id: "call_s",
            name: "searchMemory",
            arguments: JSON.stringify({ query: "커피" }),
          },
        ],
      },
      {
        kind: "tool_calls",
        tool_calls: [
          {
            id: "call_r",
            name: "addReplyMessage",
            arguments: JSON.stringify({ content: "커피 좋아하잖아" }),
          },
        ],
      },
      { kind: "text", text: "(end)" },
    ];
    const out = await brain.sendMessage(
      [{ sender: "user", time: new Date(2026, 5, 10, 9, 0, 0), content: "뭐 좋아하는지 알아?" }],
      [],
    );
    expect(out).toEqual(["커피 좋아하잖아"]);

    const toolsCalls = llmCalls.filter(
      (c) => Array.isArray(c.options.tools) && c.options.tools.length > 0,
    );
    expect(toolsCalls.length).toBeGreaterThanOrEqual(2);
    const messages = toolsCalls[1]!.options.messages as Array<{
      role: string;
      content?: string;
      toolCallId?: string;
    }>;
    const toolMsg = messages.find(
      (m) => m.role === "tool" && m.toolCallId === "call_s",
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toContain("커피");
  });

  test("SM6: sendMessage with empty history still works and includes translated user messages", async () => {
    const brain = await makeBrain();
    chatResponses = [
      {
        kind: "tool_calls",
        tool_calls: [
          {
            id: "call_r1",
            name: "addReplyMessage",
            arguments: JSON.stringify({ content: "first" }),
          },
        ],
      },
      { kind: "text", text: "(end)" },
    ];
    const out = await brain.sendMessage(
      [],
      [
        {
          sender: "user",
          time: new Date(2026, 5, 10, 9, 0, 0),
          content: "하이",
        },
      ],
    );
    expect(out).toEqual(["first"]);
    const toolsCall = llmCalls.find(
      (c) => Array.isArray(c.options.tools) && c.options.tools.length > 0,
    );
    expect(toolsCall).toBeDefined();
    const userMsg = (
      toolsCall!.options.messages as Array<{ role: string; content?: string }>
    ).find((m) => m.role === "user");
    expect(userMsg!.content).toContain("사용자@");
    expect(userMsg!.content).toContain("하이");
  });

  test("SM7: createDailySchedule persists a document reachable via brain.get", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 5);
    const tomorrow = new Date(2026, 5, 6);
    const tomorrowKey = formatDateKey(tomorrow);

    customDailySlots = build48Slots();
    await brain.createDailySchedule(today, "msg");

    const stored = await brain.get(`daily-schedule:${tomorrowKey}`);
    expect(stored).not.toBeNull();
    expect(stored!.content).toContain("slot-0");
    expect(stored!.metadata).toEqual({
      kind: "schedule",
      source: "createDailySchedule",
      date: tomorrowKey,
    });
  });

  test("SM8: sendMessage does not call brain.add (no documents added during chat)", async () => {
    const brain = await makeBrain();
    const db = brain.db as unknown as MockSupermemory;
    const before = db.documentsAddCalls;

    chatResponses = [
      {
        kind: "tool_calls",
        tool_calls: [
          {
            id: "call_r1",
            name: "addReplyMessage",
            arguments: JSON.stringify({ content: "ok" }),
          },
        ],
      },
      { kind: "text", text: "(end)" },
    ];
    await brain.sendMessage(
      [{ sender: "user", time: new Date(2026, 5, 10, 9, 0, 0), content: "hi" }],
      [],
    );
    expect(db.documentsAddCalls - before).toBe(0);
  });

  test("SM9: out-of-band add() facts are queryable via brain.search without backfill", async () => {
    const brain = await makeBrain();
    await brain.add({
      customId: "fact-pizza",
      content: "사용자는 피자를 좋아한다",
      metadata: { kind: "fact", source: "test" },
    });

    const hits = await brain.search("피자", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.content).toContain("피자");
  });
});
