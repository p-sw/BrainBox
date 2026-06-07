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
import { IdentityDB, type Space } from "identitydb";

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
  throw new Error(`unexpected jsonSchemaName: ${options.jsonSchemaName}`);
});

mock.module("@/openrouter", () => ({
  llm: {
    models: { conversation: "test-conv", identity: "test-id" },
    call: mockCall,
  },
}));

mock.module("@/config", () => ({
  config: {
    openrouterApiKey: "test-key",
    dbPath: ":memory:",
    braindbPath: "/tmp/brainbox-test-braindb.json",
  },
}));

const { Brain } = await import("./index");
const { brainManager } = await import("./manager");
const { formatDateKey, nextDay, nextMonth } = await import("./schedule");
type BrainItem = import("./manager").BrainItem;

beforeAll(async () => {
  try {
    await brainManager.deleteBrain("smoke-test-id");
  } catch {}
});

afterAll(async () => {});

async function makeBrain(): Promise<InstanceType<typeof Brain>> {
  const db = await IdentityDB.connect({
    client: "sqlite",
    filename: ":memory:",
  });
  await db.initialize();
  const spaceName = `test-space-${randomUUID()}`;
  const space: Space = await db.upsertSpace({ name: spaceName });
  const brainbase: BrainItem = {
    brainId: randomUUID(),
    spaceName,
    displayName: "Test Brain",
    baseSystemPrompt:
      "Test personality: night owl, introverted, studies at midnight.",
  };
  return new Brain(db, space, brainbase);
}

beforeEach(() => {
  llmCalls.length = 0;
  customMonthlyDays = null;
  customDailySlots = null;
  customAvailability = null;
});

describe("Brain.createDailySchedule", () => {
  test("S1: returns 48 slots in 30-min intervals and persists a fact", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 5);
    const expectedTomorrow = nextDay(today);
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

    const facts = await brain.db.getTopicFacts(
      `daily-schedule:${expectedKey}`,
      {
        spaceName: brain.space.name,
      },
    );
    expect(facts).toHaveLength(1);
    expect(JSON.parse(facts[0]!.statement).items).toHaveLength(48);
  });

  test("S4: month wrap (June 30 -> July 1)", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 30);
    const expectedKey = formatDateKey(new Date(2026, 6, 1));

    await brain.createDailySchedule(today, "");

    const facts = await brain.db.getTopicFacts(
      `daily-schedule:${expectedKey}`,
      {
        spaceName: brain.space.name,
      },
    );
    expect(facts).toHaveLength(1);
  });

  test("S4b: year wrap (December 31 -> January 1 next year)", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 11, 31);
    const expectedKey = "2027-01-01";

    await brain.createDailySchedule(today, "");

    const facts = await brain.db.getTopicFacts(
      `daily-schedule:${expectedKey}`,
      {
        spaceName: brain.space.name,
      },
    );
    expect(facts).toHaveLength(1);
  });

  test("S6: consumes monthly summary for the target day when present", async () => {
    const brain = await makeBrain();

    customMonthlyDays = Array.from({ length: 30 }, (_, i) => ({
      day: i + 1,
      summary:
        i + 1 === 10 ? "UNIQUE_SUMMARY_FOR_DAY_10" : `Day ${i + 1} summary`,
    }));

    const todayForMonthly = new Date(2026, 4, 15);
    await brain.createMonthlySchedule(todayForMonthly, "");

    const monthlyFacts = await brain.db.getTopicFacts(
      `monthly-schedule:2026-06`,
      {
        spaceName: brain.space.name,
      },
    );
    expect(monthlyFacts).toHaveLength(1);

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
});

describe("Brain.createMonthlySchedule", () => {
  test("S2: returns N day summaries (N = days in next month) and persists a fact", async () => {
    const brain = await makeBrain();
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

    const facts = await brain.db.getTopicFacts(
      `monthly-schedule:${expectedKey}`,
      {
        spaceName: brain.space.name,
      },
    );
    expect(facts).toHaveLength(1);
    expect(JSON.parse(facts[0]!.statement).items).toHaveLength(
      expected.daysInMonth,
    );
  });

  test("S5: year wrap (December 15 -> January next year)", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 11, 15);
    const expectedKey = "2027-01";

    const result = await brain.createMonthlySchedule(today, "");

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(31);

    const facts = await brain.db.getTopicFacts(
      `monthly-schedule:${expectedKey}`,
      {
        spaceName: brain.space.name,
      },
    );
    expect(facts).toHaveLength(1);
  });
});

describe("Brain.getTodayScheduledAvailability", () => {
  test("S3: returns availability windows when today's daily schedule exists", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 10);
    const todayKey = formatDateKey(today);
    await brain.db.addFact({
      spaceName: brain.space.name,
      statement: JSON.stringify({ items: build48Slots() }),
      summary: "test daily",
      source: "test",
      confidence: 1.0,
      topics: [
        {
          name: `daily-schedule:${todayKey}`,
          category: "temporal",
          granularity: "concrete",
        },
        {
          name: "daily-schedule",
          category: "concept",
          granularity: "abstract",
        },
        { name: todayKey, category: "temporal", granularity: "concrete" },
      ],
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

describe("Brain.removeScheduledAvailability", () => {
  test("S7: cache invalidated after removeScheduledAvailability()", async () => {
    const brain = await makeBrain();
    const today = new Date(2026, 5, 10);
    const todayKey = formatDateKey(today);
    await brain.db.addFact({
      spaceName: brain.space.name,
      statement: JSON.stringify({ items: build48Slots() }),
      summary: "test daily",
      source: "test",
      confidence: 1.0,
      topics: [
        {
          name: `daily-schedule:${todayKey}`,
          category: "temporal",
          granularity: "concrete",
        },
        {
          name: "daily-schedule",
          category: "concept",
          granularity: "abstract",
        },
        { name: todayKey, category: "temporal", granularity: "concrete" },
      ],
    });

    const r1 = await brain.getTodayScheduledAvailability(today);
    expect(r1).not.toBeNull();
    const callCountAfterFirst = llmCalls.length;
    expect(callCountAfterFirst).toBe(1);

    const r2 = await brain.getTodayScheduledAvailability(today);
    expect(r2).not.toBeNull();
    expect(llmCalls.length).toBe(callCountAfterFirst);

    brain.removeScheduledAvailability();

    const r3 = await brain.getTodayScheduledAvailability(today);
    expect(r3).not.toBeNull();
    expect(llmCalls.length).toBe(callCountAfterFirst + 1);
  });
});

describe("S8: regression on existing methods", () => {
  test("Brain.create and Brain.load are still defined as static methods", () => {
    expect(typeof Brain.create).toBe("function");
    expect(typeof Brain.load).toBe("function");
  });
});

describe("Brain.createDebug", () => {
  test("D1: returns a Brain with debug=true, the supplied personality, and no disk file created", async () => {
    const { existsSync } = await import("fs");
    const { resolve } = await import("path");

    const before = existsSync(resolve(process.cwd(), "brainbox.db"));

    const brain = await Brain.createDebug({ personality: "test-personality-Q" });

    expect(brain).toBeInstanceOf(Brain);
    expect(brain.debug).toBe(true);
    expect(brain.brainbase.baseSystemPrompt).toBe("test-personality-Q");
    expect(brain.brainbase.displayName).toBe("Debug Brain");

    const after = existsSync(resolve(process.cwd(), "brainbox.db"));
    expect(after).toBe(before);
  });

  test("D2: createDailySchedule on a debug brain returns a schedule and does NOT add a fact to the DB", async () => {
    const brain = await Brain.createDebug({ personality: "p" });
    const today = new Date(2026, 5, 5);
    const tomorrow = new Date(2026, 5, 6);
    const tomorrowKey = formatDateKey(tomorrow);

    const schedule = await brain.createDailySchedule(today, "msg");
    expect(schedule).not.toBeNull();
    expect(schedule!.items).toHaveLength(48);

    const facts = await brain.db.getTopicFacts(`daily-schedule:${tomorrowKey}`, {
      spaceName: brain.space.name,
    });
    expect(facts).toHaveLength(0);
  });

  test("D3: createMonthlySchedule on a debug brain returns a schedule and does NOT add a fact to the DB", async () => {
    const brain = await Brain.createDebug({ personality: "p" });
    const today = new Date(2026, 0, 15);
    const expected = nextMonth(today);
    const monthKey = `${expected.year}-${String(expected.month + 1).padStart(2, "0")}`;

    const schedule = await brain.createMonthlySchedule(today, "msg");
    expect(schedule).not.toBeNull();
    expect(schedule!.items).toHaveLength(expected.daysInMonth);

    const facts = await brain.db.getTopicFacts(
      `monthly-schedule:${monthKey}`,
      { spaceName: brain.space.name },
    );
    expect(facts).toHaveLength(0);
  });
});
