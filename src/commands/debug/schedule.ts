import type { Command } from "commander";
import ora from "ora";
import { Brain } from "@/brain";
import {
  type AvailabilityWindows,
  type DailySchedule,
  type MonthlySchedule,
} from "@/openrouter/schema";
import { formatDuration } from "@/utils/duration";
import { logger } from "@/utils/logger";
import { formatDateKey, nextMonth, pad2 } from "@/brain/schedule";

export interface ScheduleOptions {
  message: string;
  personality: string;
}

export type DailyRunResult =
  | {
      ok: true;
      kind: "daily";
      dateKey: string;
      tomorrow: Date;
      schedule: DailySchedule;
      availability: AvailabilityWindows;
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

  const brain = await Brain.createDebug({ personality: opts.personality });

  const scheduleSpinner = ora(
    `Generating daily schedule for ${dateKey}...`,
  ).start();
  const schedule = await brain.createDailySchedule(today, opts.message);
  if (!schedule) {
    scheduleSpinner.fail("Daily schedule generation failed");
    const elapsedMs = Date.now() - startTime;
    return {
      ok: false,
      error: "Daily schedule generation failed",
      elapsedMs,
    };
  }
  scheduleSpinner.succeed(
    `Daily schedule generated (${schedule.items.length} slots)`,
  );

  printSection(
    `Daily Schedule — ${dateKey} (${tomorrow.toLocaleDateString("en-US", { weekday: "long" })})`,
  );
  console.log(JSON.stringify(schedule, null, 2));

  const availSpinner = ora("Deriving availability...").start();
  const availability = await brain.deriveAvailabilityFromSchedule(schedule);
  if (!availability) {
    availSpinner.fail("Availability derivation failed");
    const elapsedMs = Date.now() - startTime;
    return {
      ok: false,
      error: "Availability derivation failed",
      elapsedMs,
    };
  }
  availSpinner.succeed(
    `Availability derived (${availability.items.length} windows)`,
  );

  printSection(`Availability — ${dateKey}`);
  console.log(JSON.stringify(availability, null, 2));

  const elapsedMs = Date.now() - startTime;
  logger.info(
    `Debug run complete in ${formatDuration(elapsedMs)}. Nothing was written to disk.`,
  );

  return {
    ok: true,
    kind: "daily",
    dateKey,
    tomorrow,
    schedule,
    availability,
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

  const brain = await Brain.createDebug({ personality: opts.personality });

  const scheduleSpinner = ora(
    `Generating monthly schedule for ${monthKey} (${next.daysInMonth} days)...`,
  ).start();
  const schedule = await brain.createMonthlySchedule(today, opts.message);
  if (!schedule) {
    scheduleSpinner.fail("Monthly schedule generation failed");
    const elapsedMs = Date.now() - startTime;
    return {
      ok: false,
      error: "Monthly schedule generation failed",
      elapsedMs,
    };
  }
  scheduleSpinner.succeed(
    `Monthly schedule generated (${schedule.items.length} day summaries)`,
  );

  printSection(`Monthly Schedule — ${monthKey} (${next.daysInMonth} days)`);
  console.log(JSON.stringify(schedule, null, 2));

  const elapsedMs = Date.now() - startTime;
  logger.info(
    `Debug run complete in ${formatDuration(elapsedMs)}. Nothing was written to disk. (Availability applies per-day and is not generated for the monthly view.)`,
  );

  return {
    ok: true,
    kind: "monthly",
    monthKey,
    daysInMonth: next.daysInMonth,
    schedule,
    elapsedMs,
  };
}

export function addScheduleSubcommand(parent: Command): Command {
  const cmd = parent
    .command("schedule")
    .description("Generate a test schedule (no disk writes)");

  cmd.command("daily")
    .description(
      "Generate a daily schedule for tomorrow and print schedule + availability",
    )
    .requiredOption("-m, --message <text>", "User direction for the schedule")
    .requiredOption("-p, --personality <text>", "Brain personality to use")
    .action(async (opts: ScheduleOptions) => {
      const result = await runDebugScheduleDaily(opts);
      if (!result.ok) {
        logger.error(result.error);
        process.exit(1);
      }
    });

  cmd.command("monthly")
    .description("Generate a monthly schedule for next month and print it")
    .requiredOption("-m, --message <text>", "User direction for the schedule")
    .requiredOption("-p, --personality <text>", "Brain personality to use")
    .action(async (opts: ScheduleOptions) => {
      const result = await runDebugScheduleMonthly(opts);
      if (!result.ok) {
        logger.error(result.error);
        process.exit(1);
      }
    });

  return cmd;
}

function printSection(title: string): void {
  const line = "─".repeat(Math.max(40, title.length + 4));
  console.log(`\n┌${line}┐`);
  console.log(`│  ${title}`);
  console.log(`└${line}┘`);
}
