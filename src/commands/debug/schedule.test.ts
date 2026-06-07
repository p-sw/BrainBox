import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  Availability,
  DailySlot,
  MonthlyDay,
} from "@/openrouter/schema";

interface RecordedCall {
  model: unknown;
  options: { jsonSchemaName?: string; message?: string };
}

const llmCalls: RecordedCall[] = [];

function build48Slots(): DailySlot[] {
  const slots: DailySlot[] = [];
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

function buildAvailability(): Availability[] {
  return [
    { start: "00:00", end: "07:00", status: "offline" },
    { start: "07:00", end: "23:30", status: "online" },
    { start: "23:30", end: "24:00", status: "offline" },
  ];
}

function buildMonthlyDays(): MonthlyDay[] {
  return Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    summary: `Day ${i + 1} summary`,
  }));
}

const mockCall = mock(async (_model: unknown, options: any) => {
  llmCalls.push({ model: _model, options });
  if (options.jsonSchemaName === "daily-schedule")
    return { items: build48Slots() };
  if (options.jsonSchemaName === "monthly-schedule") {
    const match = (options.message as string).match(/\((\d+) days\)/);
    const days = match ? parseInt(match[1]!, 10) : 30;
    return {
      items: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        summary: `Day ${i + 1} summary`,
      })),
    };
  }
  if (options.jsonSchemaName === "availability")
    return { items: buildAvailability() };
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
    braindbPath: "/tmp/brainbox-test-braindb-debug-schedule.json",
  },
}));

const { runDebugScheduleDaily, runDebugScheduleMonthly } = await import(
  "./schedule"
);

beforeEach(() => {
  llmCalls.length = 0;
  mockCall.mockClear();
});

afterEach(async () => {
  const { unlink } = await import("fs/promises");
  try {
    await unlink("/tmp/brainbox-test-braindb-debug-schedule.json");
  } catch {}
});

describe("runDebugScheduleDaily", () => {
  test("T1: returns ok result with schedule and availability, uses the supplied personality", async () => {
    const result = await runDebugScheduleDaily({
      message: "focus on writing",
      personality: "test-personality-XYZ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.kind).toBe("daily");
    expect(result.schedule.items).toHaveLength(48);
    expect(result.availability.items.length).toBeGreaterThan(0);
    expect(result.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const dailyCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "daily-schedule",
    );
    expect(dailyCall).toBeDefined();
    expect(dailyCall!.options.message).toContain("test-personality-XYZ");
    expect(dailyCall!.options.message).toContain("focus on writing");

    const availCall = llmCalls.find(
      (c) => c.options.jsonSchemaName === "availability",
    );
    expect(availCall).toBeDefined();
  });

  test("T2: when LLM returns null for daily, returns {ok: false, error}", async () => {
    mockCall.mockImplementationOnce(async () => null as unknown as never);
    const result = await runDebugScheduleDaily({
      message: "",
      personality: "p",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.error).toMatch(/Daily schedule generation failed/);
  });
});

describe("runDebugScheduleMonthly", () => {
  test("T3: returns ok result with monthly schedule, uses the supplied personality", async () => {
    const result = await runDebugScheduleMonthly({
      message: "study for GRE",
      personality: "test-personality-ABC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.kind).toBe("monthly");
    expect(result.schedule.items).toHaveLength(result.daysInMonth);
    expect(result.monthKey).toMatch(/^\d{4}-\d{2}$/);

    const call = llmCalls.find(
      (c) => c.options.jsonSchemaName === "monthly-schedule",
    );
    expect(call).toBeDefined();
    expect(call!.options.message).toContain("test-personality-ABC");
    expect(call!.options.message).toContain("study for GRE");
  });

  test("T4: when LLM returns null for monthly, returns {ok: false, error}", async () => {
    mockCall.mockImplementationOnce(async () => null as unknown as never);
    const result = await runDebugScheduleMonthly({
      message: "",
      personality: "p",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.error).toMatch(/Monthly schedule generation failed/);
  });
});

describe("debug schedule no-disk invariant", () => {
  test("T5: running a debug schedule does not create a brainbox db file on disk", async () => {
    const { existsSync } = await import("fs");
    const { resolve } = await import("path");

    const beforeDb = existsSync(resolve(process.cwd(), "brainbox.db"));
    const beforeJson = existsSync(resolve(process.cwd(), "brainbox.json"));

    await runDebugScheduleDaily({ message: "m", personality: "p" });

    const afterDb = existsSync(resolve(process.cwd(), "brainbox.db"));
    const afterJson = existsSync(resolve(process.cwd(), "brainbox.json"));

    expect(beforeDb).toBe(false);
    expect(beforeJson).toBe(false);
    expect(afterDb).toBe(false);
    expect(afterJson).toBe(false);
  });
});

