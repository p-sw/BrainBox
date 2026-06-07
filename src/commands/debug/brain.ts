import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Command } from "commander";
import ora from "ora";
import { Brain } from "@/brain";
import { logger } from "@/utils/logger";

export interface BrainInitOptions {
  displayName: string;
  seed: string;
}

export type BrainInitResult =
  | {
      ok: true;
      kind: "init";
      displayName: string;
      brainId: string;
      spaceName: string;
      baseSystemPrompt: string;
    }
  | { ok: false; error: string };

/**
 * Exercise the full `Brain.create` flow (PERSONA_INIT → PERSONA_BASE_SYSTEM_PROMPT
 * LLM calls → SQLite DB upsert → fact extraction → braindb save) without
 * touching real on-disk state.
 *
 * - SQLite DB uses `:memory:` (ephemeral, dies with the process).
 * - The braindb JSON is written to a fresh temp file under `os.tmpdir()`
 *   and unlinked after the run.
 */
export async function runDebugBrainInit(
  opts: BrainInitOptions,
): Promise<BrainInitResult> {
  const braindbPath = join(
    tmpdir(),
    `brainbox-debug-brain-${randomUUID()}.json`,
  );
  await writeFile(braindbPath, "{}", { encoding: "utf-8" });
  const spinner = ora(
    `Initializing brain "${opts.displayName}" with LLM (debug, no real disk state)...`,
  ).start();
  try {
    const brain = await Brain.create(opts.displayName, opts.seed, {
      dbPath: ":memory:",
      braindbPath,
    });
    if (!brain) {
      spinner.fail("Brain initialization failed");
      return { ok: false, error: "Brain initialization failed" };
    }
    spinner.succeed(
      `Brain initialized (id=${brain.brainbase.brainId}, space=${brain.brainbase.spaceName})`,
    );

    printSection(
      `Brain — ${opts.displayName} (${brain.brainbase.brainId})`,
    );
    console.log(`spaceName:        ${brain.brainbase.spaceName}`);
    console.log(`displayName:      ${brain.brainbase.displayName}`);
    console.log(`baseSystemPrompt (first 240 chars):`);
    console.log(
      `  ${brain.brainbase.baseSystemPrompt.slice(0, 240).replace(/\n/g, "\n  ")}${brain.brainbase.baseSystemPrompt.length > 240 ? "..." : ""}`,
    );

    logger.info("Debug run complete. Nothing was written to real disk.");

    return {
      ok: true,
      kind: "init",
      displayName: opts.displayName,
      brainId: brain.brainbase.brainId,
      spaceName: brain.brainbase.spaceName,
      baseSystemPrompt: brain.brainbase.baseSystemPrompt,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    spinner.fail("Brain initialization failed");
    return { ok: false, error: reason };
  } finally {
    // Clean up the temp braindb file regardless of success/failure.
    try {
      await unlink(braindbPath);
    } catch {}
  }
}

export function addBrainSubcommand(parent: Command): Command {
  const cmd = parent
    .command("brain")
    .description(
      "Debug tools for brain lifecycle (no real disk writes)",
    );

  cmd
    .command("init")
    .description(
      "Initialize a new brain with LLM (in-memory DB, temp braindb; nothing persisted)",
    )
    .requiredOption("-n, --name <text>", "Display name for the new brain")
    .requiredOption(
      "-s, --seed <text>",
      "Seed text used to generate the persona biography",
    )
    .action(async (opts: { name: string; seed: string }) => {
      const result = await runDebugBrainInit({
        displayName: opts.name,
        seed: opts.seed,
      });
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
