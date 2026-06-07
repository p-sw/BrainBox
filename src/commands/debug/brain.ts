import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Command } from "commander";
import ora from "ora";
import type { ExtractedFact } from "identitydb";
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
      description: string;
      baseSystemPrompt: string;
      extractedFacts: ExtractedFact[];
    }
  | { ok: false; error: string };

/**
 * Exercise the full `Brain.create` flow (PERSONA_INIT → PERSONA_BASE_SYSTEM_PROMPT
 * LLM calls → SQLite DB upsert → fact extraction via `factExtractor.extract` →
 * braindb save) without touching real on-disk state.
 *
 * - SQLite DB uses `:memory:` (ephemeral, dies with the process).
 * - The braindb JSON is written to a fresh temp file under `os.tmpdir()`
 *   and unlinked after the run.
 *
 * Prints the full text of:
 *   1. the generated `description` (PERSONA_INIT output)
 *   2. the concatenated `baseSystemPrompt` (generated + fixed)
 *   3. the `extractedFacts` (obtained by directly calling
 *      `factExtractor.extract(description)`)
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
    const result = await Brain.create(opts.displayName, opts.seed, {
      dbPath: ":memory:",
      braindbPath,
      debug: true,
    });
    if (!result) {
      spinner.fail("Brain initialization failed");
      return { ok: false, error: "Brain initialization failed" };
    }
    const {
      brain,
      description,
      baseSystemPrompt,
      extractedFacts,
    } = result;
    const factCount = extractedFacts?.length ?? 0;
    spinner.succeed(
      `Brain initialized (id=${brain.brainbase.brainId}, space=${brain.brainbase.spaceName}, ${factCount} fact(s) extracted)`,
    );

    printSection(`Description (PERSONA_INIT output)`);
    console.log(description);
    console.log();

    printSection(`baseSystemPrompt (PERSONA_BASE_SYSTEM_PROMPT + FIXED)`);
    console.log(baseSystemPrompt);
    console.log();

    printSection(
      `Extracted facts (factExtractor.extract — ${factCount})`,
    );
    if (extractedFacts && extractedFacts.length > 0) {
      extractedFacts.forEach((fact, i) => {
        console.log(`\n[${i + 1}/${extractedFacts.length}]`);
        console.log(`  statement:   ${fact.statement ?? ""}`);
        console.log(`  summary:     ${fact.summary ?? ""}`);
        console.log(`  source:      ${fact.source ?? ""}`);
        console.log(`  confidence:  ${fact.confidence ?? ""}`);
        console.log(`  topics:      ${JSON.stringify(fact.topics)}`);
        if (fact.metadata) {
          console.log(`  metadata:    ${JSON.stringify(fact.metadata)}`);
        }
      });
    } else {
      console.log("  (no facts extracted)");
    }
    console.log();

    logger.info("Debug run complete. Nothing was written to real disk.");

    return {
      ok: true,
      kind: "init",
      displayName: opts.displayName,
      brainId: brain.brainbase.brainId,
      spaceName: brain.brainbase.spaceName,
      description,
      baseSystemPrompt,
      extractedFacts: extractedFacts ?? [],
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    spinner.fail("Brain initialization failed");
    return { ok: false, error: reason };
  } finally {
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
