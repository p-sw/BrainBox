import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Command } from "commander";
import { runCreateSteps } from "@/brain";
import { MemoryStub } from "@/brain/stub";
import { formatDuration } from "@/utils/duration";
import { logger } from "@/utils/logger";
import {
  StepDriver,
  printKeyValue,
  printSection,
} from "./output";

export interface BrainInitOptions {
  displayName: string;
  seed: string;
  noSupermemory: boolean;
}

export type BrainInitResult =
  | {
      ok: true;
      kind: "init";
      displayName: string;
      brainId: string;
      spaceName: string;
      description: string;
      baseSystemPrompt: string;
      storedFacts: Array<{ customId: string | null; content: string }>;
      storageMode: "supermemory" | "stub";
      elapsedMs: number;
    }
  | { ok: false; error: string; elapsedMs: number };

export async function runDebugBrainInit(
  opts: BrainInitOptions,
): Promise<BrainInitResult> {
  const startTime = Date.now();
  const braindbPath = join(
    tmpdir(),
    `brainbox-debug-brain-${randomUUID()}.json`,
  );
  await writeFile(braindbPath, "{}", { encoding: "utf-8" });
  const storageMode = opts.noSupermemory ? "stub" : "supermemory";
  const db = opts.noSupermemory ? new MemoryStub() : undefined;

  try {
    const steps = new StepDriver(4);

    const result = await runCreateSteps(opts.displayName, opts.seed, {
      braindbPath,
      db,
    }, steps);
    if (!result) {
      const elapsedMs = Date.now() - startTime;
      return { ok: false, error: "Brain initialization failed", elapsedMs };
    }
    const { brain, description, baseSystemPrompt } = result;
    const storedFacts = await brain.list();

    console.log();
    printSection(`Brain — ${brain.brainbase.displayName}`);
    printKeyValue({
      brainId: brain.brainbase.brainId,
      spaceName: brain.brainbase.spaceName,
      storage: storageMode,
      documents: String(storedFacts.length),
    });
    console.log();

    printSection(`Step 1 output — Description (PERSONA_INIT)`);
    console.log(description);
    console.log();

    printSection(`Step 2 output — baseSystemPrompt (PERSONA_BASE_SYSTEM_PROMPT + FIXED)`);
    console.log(baseSystemPrompt);
    console.log();

    printSection(`Step 3 output — Stored documents (brain.list() — ${storedFacts.length})`);
    if (storedFacts.length > 0) {
      storedFacts.forEach((doc, i) => {
        console.log();
        console.log(`[${i + 1}/${storedFacts.length}]`);
        printKeyValue({
          customId: doc.customId ?? "(none)",
          content: doc.content,
        });
      });
    } else {
      console.log("  (no documents stored)");
    }
    console.log();

    const elapsedMs = Date.now() - startTime;
    logger.info(
      `Debug run complete in ${formatDuration(elapsedMs)}. Nothing was written to real disk.`,
    );

    return {
      ok: true,
      kind: "init",
      displayName: opts.displayName,
      brainId: brain.brainbase.brainId,
      spaceName: brain.brainbase.spaceName,
      description,
      baseSystemPrompt,
      storedFacts,
      storageMode,
      elapsedMs,
    };
  } finally {
    try {
      await unlink(braindbPath);
    } catch {}
  }
}

export function addBrainSubcommand(parent: Command): Command {
  const cmd = parent
    .command("brain")
    .description("Debug tools for brain lifecycle (no real disk writes)");

  cmd
    .command("init")
    .description(
      "Initialize a new brain with LLM (temp braindb; nothing persisted to repo)",
    )
    .requiredOption("-n, --name <text>", "Display name for the new brain")
    .requiredOption(
      "-s, --seed <text>",
      "Seed text used to generate the persona biography",
    )
    .option(
      "--no-supermemory",
      "Use an in-memory stub instead of the real supermemory API (no network, no API key required)",
    )
    .action(
      async (opts: { name: string; seed: string; supermemory: boolean }) => {
        const result = await runDebugBrainInit({
          displayName: opts.name,
          seed: opts.seed,
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
