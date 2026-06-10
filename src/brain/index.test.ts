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

/**
 * Queue of LLM responses for tool-calling flows (sendMessage). Each entry is
 * returned in order. Shape matches OpenRouter's `ChatResult.choices[0]`
 * reduced form: `{ content, tool_calls, finish_reason }`.
 */
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

async function makeBrain(
  embeddingProvider: unknown = NOOP_EMBEDDING_PROVIDER,
): Promise<InstanceType<typeof Brain>> {
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
  return new Brain(db, space, brainbase, false, embeddingProvider as never);
}

beforeEach(() => {
  llmCalls.length = 0;
  customMonthlyDays = null;
  customDailySlots = null;
  customAvailability = null;
  chatResponses = [];
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

const NOOP_EMBEDDING_PROVIDER = {
  model: "test-embed",
  dimensions: 4,
  async embed(_input: string): Promise<number[]> {
    return [0, 0, 0, 0];
  },
  async embedMany(inputs: string[]): Promise<number[][]> {
    return inputs.map(() => [0, 0, 0, 0]);
  },
};

const SCORING_EMBEDDING_PROVIDER = {
  model: "test-embed-scoring",
  dimensions: 4,
  async embed(input: string): Promise<number[]> {
    if (input.includes("coffee")) return [1, 0, 0, 0];
    if (input.includes("pizza")) return [0, 1, 0, 0];
    return [0, 0, 1, 0];
  },
  async embedMany(inputs: string[]): Promise<number[][]> {
    return inputs.map((s) => {
      if (s.includes("coffee")) return [1, 0, 0, 0];
      if (s.includes("pizza")) return [0, 1, 0, 0];
      return [0, 0, 1, 0];
    });
  },
};

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
    expect(toolNames).toContain("searchIdentityDB");
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

  test("SM5: sendMessage feeds searchIdentityDB tool result back to the LLM", async () => {
    const brain = await makeBrain(SCORING_EMBEDDING_PROVIDER);
    const fact = await brain.db.addFact({
      spaceName: brain.space.name,
      statement: "사용자는 커피를 좋아한다",
      summary: "user loves coffee",
      source: "test",
      confidence: 1.0,
      topics: [
        { name: "사용자", category: "entity", granularity: "concrete" },
        { name: "커피", category: "concept", granularity: "abstract" },
      ],
    });
    await brain.indexFactEmbeddingFor(fact);

    chatResponses = [
      {
        kind: "tool_calls",
        tool_calls: [
          {
            id: "call_s",
            name: "searchIdentityDB",
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

  test("SM7: createDailySchedule auto-indexes the new fact so it is searchable via the provider", async () => {
    const brain = await makeBrain(SCORING_EMBEDDING_PROVIDER);
    const today = new Date(2026, 5, 5);
    const tomorrow = new Date(2026, 5, 6);
    const tomorrowKey = formatDateKey(tomorrow);

    customDailySlots = build48Slots();
    await brain.createDailySchedule(today, "msg");

    const hits = await brain.db.searchFacts({
      spaceName: brain.space.name,
      query: "slot-0",
      provider: SCORING_EMBEDDING_PROVIDER as never,
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    const matched = hits.find((h) =>
      h.statement.includes(`"activity":"slot-0"`),
    );
    expect(matched).toBeDefined();

    const topicFacts = await brain.db.getTopicFacts(
      `daily-schedule:${tomorrowKey}`,
      { spaceName: brain.space.name },
    );
    expect(topicFacts).toHaveLength(1);
  });

  test("SM8: sendMessage no longer calls indexFactEmbeddings on every turn (uses per-fact init)", async () => {
    const brain = await makeBrain(NOOP_EMBEDDING_PROVIDER);
    let embedManyCalls = 0;
    const trackingProvider = {
      model: "track-embed",
      dimensions: 4,
      async embed(_input: string): Promise<number[]> {
        return [0, 0, 0, 0];
      },
      async embedMany(inputs: string[]): Promise<number[][]> {
        embedManyCalls += 1;
        return inputs.map(() => [0, 0, 0, 0]);
      },
    };
    Object.defineProperty(brain, "embeddingProvider", {
      value: trackingProvider,
      configurable: true,
    });

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
    expect(embedManyCalls).toBe(0);
  });

  test("SM9: initializeEmbeddings backfills missing embeddings for facts added out-of-band", async () => {
    const brain = await makeBrain(SCORING_EMBEDDING_PROVIDER);
    await brain.db.addFact({
      spaceName: brain.space.name,
      statement: "사용자는 피자를 좋아한다",
      summary: "user loves pizza",
      source: "test",
      confidence: 1.0,
      topics: [
        { name: "사용자", category: "entity", granularity: "concrete" },
        { name: "피자", category: "concept", granularity: "abstract" },
      ],
    });

    let preInitHits = await brain.db.searchFacts({
      spaceName: brain.space.name,
      query: "피자",
      provider: SCORING_EMBEDDING_PROVIDER as never,
      limit: 5,
    });
    expect(preInitHits).toHaveLength(0);

    await brain.initializeEmbeddings();

    const postInitHits = await brain.db.searchFacts({
      spaceName: brain.space.name,
      query: "피자",
      provider: SCORING_EMBEDDING_PROVIDER as never,
      limit: 5,
    });
    expect(postInitHits.length).toBeGreaterThan(0);
    expect(postInitHits[0]!.statement).toContain("피자");
  });
});
