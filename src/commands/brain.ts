import type { Command } from "commander";
import chalk from "chalk";
import { registerCommand } from "@/commands";
import { brainManager } from "@/brain/manager";
import { Brain } from "@/brain";
import { logger } from "@/utils/logger";
import { sendToDaemon, type DaemonResponse } from "@/utils/daemonClient";
import { DO_ACTIONS, type DoAction, VIEW_THINGS, type ViewThing } from "@/channel/base";

export async function listBrains(): Promise<void> {
  const brains = await brainManager.listBrains();
  logger.debug(`listBrains: ${brains.length} brain(s)`);
  if (brains.length === 0) {
    logger.info("No brains found.");
    return;
  }
  for (const b of brains) {
    const status = b.activated ? chalk.green("active") : chalk.gray("inactive");
    const channel = b.channel ? chalk.cyan(b.channel) : chalk.gray("-");
    const name = chalk.bold(b.displayName);
    console.log(`${b.brainId}  ${name}  ${status}  ${channel}`);
  }
}

async function setActivated(
  brainId: string,
  activated: boolean,
): Promise<void> {
  logger.debug(`setActivated: id=${brainId} → ${activated}`);
  const brain = await brainManager.loadBrain(brainId);
  if (!brain) {
    logger.error(`Brain not found: ${brainId}`);
    process.exitCode = 1;
    return;
  }
  if (brain.activated === activated) {
    const verb = activated ? "activated" : "deactivated";
    logger.info(`Brain "${brain.displayName}" is already ${verb}.`);
    return;
  }
  await brainManager.saveBrain(brainId, { ...brain, activated });
  const verb = activated ? "Activated" : "Deactivated";
  logger.success(`${verb} brain "${brain.displayName}" (${brain.brainId})`);
}

export async function activateBrain(brainId: string): Promise<void> {
  await setActivated(brainId, true);
}

export async function deactivateBrain(brainId: string): Promise<void> {
  await setActivated(brainId, false);
}

export async function createBrain(
  displayName: string,
  seed: string | undefined,
  options: { schedule: boolean; language: string },
): Promise<void> {
  const language = options.language?.trim() || "English";
  const seedText = (seed ?? "").trim();
  if (!seedText) {
    logger.error(
      'Seed is required. Usage: brainbox brain create <name> "<seed description>"',
    );
    process.exitCode = 1;
    return;
  }
  logger.debug(
    `createBrain: name="${displayName}" language="${language}" seed length=${seedText.length} schedule=${options.schedule}`,
  );
  const result = await Brain.create(displayName, seedText, { language });
  if ("error" in result) {
    logger.error(`Failed to create brain "${displayName}": ${result.error}`);
    process.exitCode = 1;
    return;
  }
  if (options.schedule) {
    await result.brain.regenerateSchedules();
    logger.success(
      `Created brain "${displayName}" (${chalk.cyan(result.brainId)}) [${language}] with initial schedule`,
    );
  } else {
    logger.success(
      `Created brain "${displayName}" (${chalk.cyan(result.brainId)}) [${language}]`,
    );
  }
}

export async function removeBrain(brainId: string): Promise<void> {
  logger.debug(`removeBrain: id=${brainId}`);
  const brain = await brainManager.loadBrain(brainId);
  if (!brain) {
    logger.error(`Brain not found: ${brainId}`);
    process.exitCode = 1;
    return;
  }
  const removed = await Brain.delete(brainId);
  if (!removed) {
    process.exitCode = 1;
    return;
  }
  logger.success(
    `Removed brain "${brain.displayName}" (${chalk.cyan(brainId)})`,
  );
}

export async function doAction(action: string, brainId: string): Promise<void> {
  if (!DO_ACTIONS.includes(action as DoAction)) {
    logger.error(
      `Unknown action "${action}". Expected one of: ${DO_ACTIONS.join(", ")}`,
    );
    process.exit(1);
  }
  logger.debug(`do: action=${action} brainId=${brainId}`);
  // ponytail: sendToDaemon logs and process.exit(1)s on any failure.
  const response = await sendToDaemon<
    DaemonResponse<{ action: string; brainId: string; displayName: string }>
  >({
    command: "do",
    args: { action, brainId },
  });
  const name = response.result?.displayName ?? brainId;
  logger.success(
    `Successfully sent ${action} for "${name}" (${brainId}).`,
  );
}

export async function viewThing(thing: string, brainId: string): Promise<void> {
  if (!VIEW_THINGS.includes(thing as ViewThing)) {
    logger.error(
      `Unknown thing "${thing}". Expected one of: ${VIEW_THINGS.join(", ")}`,
    );
    process.exit(1);
  }
  logger.debug(`view: thing=${thing} brainId=${brainId}`);
  // ponytail: sendToDaemon logs and process.exit(1)s on any failure.
  const response = await sendToDaemon<
    DaemonResponse<{
      thing: string;
      brainId: string;
      displayName: string;
      value: unknown;
    }>
  >({
    command: "view",
    args: { thing, brainId },
  });
  const name = response.result?.displayName ?? brainId;
  logger.info(`${thing} — "${name}" (${brainId})`);
  console.log(JSON.stringify(response.result?.value ?? null, null, 2));
}

export function register(program: Command): Command {
  const cmd = registerCommand(program, {
    name: "brain",
    description: "Manage brains",
  });
  cmd.command("list").description("List all brains").action(listBrains);
  cmd
    .command("create <name> [seed]")
    .description("Create a new brain from a free-form seed")
    .option("--no-schedule", "Skip generating the initial schedule")
    .option(
      "-l, --language <language>",
      "Primary chat language for the persona",
      "English",
    )
    .action(createBrain);
  cmd
    .command("remove <brainId>")
    .description("Remove a brain and its memory")
    .action(removeBrain);
  cmd
    .command("activate <brainId>")
    .description("Activate a brain")
    .action(activateBrain);
  cmd
    .command("deactivate <brainId>")
    .description("Deactivate a brain")
    .action(deactivateBrain);
  cmd
    .command("do <action> <brainId>")
    .description(
      `Force-run a daemon job (${DO_ACTIONS.join(" | ")}) for a live brain`,
    )
    .action(doAction);
  cmd
    .command("view <thing> <brainId>")
    .description(
      `Inspect a live brain value (${VIEW_THINGS.join(" | ")})`,
    )
    .action(viewThing);
  return cmd;
}
