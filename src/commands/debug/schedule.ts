import type { Command } from "commander";
import {
  Brain,
  runCreateDailyScheduleSteps,
  runCreateMonthlyScheduleSteps,
} from "@/brain";
import { MemoryStub } from "@/brain/stub";
import {
  type AvailabilityWindows,
  type DailySchedule,
  type MonthlySchedule,
} from "@/openrouter/schema";
import { formatDuration } from "@/utils/duration";
import { logger } from "@/utils/logger";
import { formatDateKey, nextMonth, pad2 } from "@/brain/schedule";
import {
  StepDriver,
  printKeyValue,
  printSection,
} from "./output";

export interface ScheduleOptions {
  message: string;
  personality: string;
  noSupermemory: boolean;
}

export type DailyRunResult =
  | {
      ok: true;
      kind: "daily";
      dateKey: string;
      tomorrow: Date;
      schedule: DailySchedule;
      availability: AvailabilityWindows;
      storageMode: "supermemory" | "stub";
      elapsedMs: number;
    }
  | { ok: false; error: string; elapsedMs: number };

export type MonthlyRunResult =
  | {
      ok: true;
      kind: "monthly";
      monthKey: string;
      daysInMonth: number;
      schedule: MonthlySchedule;
      storageMode: "supermemory" | "stub";
      elapsedMs: number;
    }
  | { ok: false; error: string; elapsedMs: number };

export async function runDebugScheduleDaily(
  opts: ScheduleOptions,
): Promise<DailyRunResult> {
  const startTime = Date.now();
  const today = new Date();
  const tomorrow = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  );
  const dateKey = formatDateKey(tomorrow);
  const storageMode = opts.noSupermemory ? "stub" : "supermemory";
  const db = opts.noSupermemory ? new MemoryStub() : undefined;

  const brain = await Brain.createDebug(
    { personality: opts.personality },
    db,
  );

  const steps = new StepDriver(4);

  const schedule = await runCreateDailyScheduleSteps(
    brain,
    today,
    opts.message,
    steps,
  );
  if (!schedule) {
    const elapsedMs = Date.now() - startTime;
    return {
      ok: false,
      error: "Daily schedule generation failed",
      elapsedMs,
    };
  }

  steps.start("deriving availability (SCHEDULE_AVAILABILITY)");
  const availability = await brain.deriveAvailabilityFromSchedule(schedule);
  if (!availability) {
    steps.fail("see error above");
    const elapsedMs = Date.now() - startTime;
    return {
      ok: false,
      error: "Availability derivation failed",
      elapsedMs,
    };
  }
  steps.done(`${availability.items.length} windows`);

  console.log();
  printSection(`Schedule — daily (${dateKey})`);
  printKeyValue({
    dateKey,
    weekday: tomorrow.toLocaleDateString("en-US", { weekday: "long" }),
    storage: storageMode,
    slots: String(schedule.items.length),
  });
  console.log();

  printSection(`Step 1/2 output — Daily Schedule (DAILY_SCHEDULE)`);
  console.log(JSON.stringify(schedule, null, 2));
  console.log();

  printSection(`Step 2/2 output — Availability (SCHEDULE_AVAILABILITY)`);
  console.log(JSON.stringify(availability, null, 2));
  console.log();

  const elapsedMs = Date.now() - startTime;
  logger.info(
    `Debug run complete in ${formatDuration(elapsedMs)}. Nothing was written to real disk.`,
  );

  return {
    ok: true,
    kind: "daily",
    dateKey,
    tomorrow,
    schedule,
    availability,
    storageMode,
    elapsedMs,
  };
}

export async function runDebugScheduleMonthly(
  opts: ScheduleOptions,
): Promise<MonthlyRunResult> {
  const startTime = Date.now();
  const today = new Date();
  const next = nextMonth(today);
  const monthKey = `${next.year}-${pad2(next.month + 1)}`;
  const storageMode = opts.noSupermemory ? "stub" : "supermemory";
  const db = opts.noSupermemory ? new MemoryStub() : undefined;

  const brain = await Brain.createDebug(
    { personality: opts.personality },
    db,
  );

  const steps = new StepDriver(3);

  const schedule = await runCreateMonthlyScheduleSteps(
    brain,
    today,
    opts.message,
    steps,
  );
  if (!schedule) {
    const elapsedMs = Date.now() - startTime;
    return {
      ok: false,
      error: "Monthly schedule generation failed",
      elapsedMs,
    };
  }

  console.log();
  printSection(`Schedule — monthly (${monthKey})`);
  printKeyValue({
    monthKey,
    daysInMonth: String(next.daysInMonth),
    storage: storageMode,
    summaries: String(schedule.items.length),
  });
  console.log();

  printSection(`Step 1/1 output — Monthly Schedule (MONTHLY_SCHEDULE)`);
  console.log(JSON.stringify(schedule, null, 2));
  console.log();

  const elapsedMs = Date.now() - startTime;
  logger.info(
    `Debug run complete in ${formatDuration(elapsedMs)}. Nothing was written to real disk. (Availability applies per-day and is not generated for the monthly view.)`,
  );

  return {
    ok: true,
    kind: "monthly",
    monthKey,
    daysInMonth: next.daysInMonth,
    schedule,
    storageMode,
    elapsedMs,
  };
}

export function addScheduleSubcommand(parent: Command): Command {
  const cmd = parent
    .command("schedule")
    .description("Generate a test schedule (no disk writes)");

  cmd
    .command("daily")
    .description(
      "Generate a daily schedule for tomorrow and print schedule + availability",
    )
    .requiredOption("-m, --message <text>", "User direction for the schedule")
    .requiredOption("-p, --personality <text>", "Brain personality to use")
    .option(
      "--no-supermemory",
      "Use an in-memory stub instead of the real supermemory API (no network, no API key required)",
    )
    .action(
      async (opts: { message: string; personality: string; supermemory: boolean }) => {
        const result = await runDebugScheduleDaily({
          message: opts.message,
          personality: opts.personality,
          noSupermemory: opts.supermemory === false,
        });
        if (!result.ok) {
          logger.error(result.error);
          process.exit(1);
        }
      },
    );

  cmd
    .command("monthly")
    .description("Generate a monthly schedule for next month and print it")
    .requiredOption("-m, --message <text>", "User direction for the schedule")
    .requiredOption("-p, --personality <text>", "Brain personality to use")
    .option(
      "--no-supermemory",
      "Use an in-memory stub instead of the real supermemory API (no network, no API key required)",
    )
    .action(
      async (opts: { message: string; personality: string; supermemory: boolean }) => {
        const result = await runDebugScheduleMonthly({
          message: opts.message,
          personality: opts.personality,
          noSupermemory: opts.supermemory === false,
        });
        if (!result.ok) {
          logger.error(result.error);
          process.exit(1);
        }
      },
    );

  return cmd;
}
