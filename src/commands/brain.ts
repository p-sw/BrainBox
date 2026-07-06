import type { Command } from "commander";
import chalk from "chalk";
import { registerCommand } from "@/commands";
import { brainManager } from "@/brain/manager";
import { Brain } from "@/brain";
import { logger } from "@/utils/logger";

export async function listBrains(): Promise<void> {
  const brains = await brainManager.listBrains();
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
  seed: string,
): Promise<void> {
  const result = await Brain.create(displayName, seed);
  if (!result) {
    process.exitCode = 1;
    return;
  }
  logger.success(
    `Created brain "${displayName}" (${chalk.cyan(result.brainId)})`,
  );
}

export async function removeBrain(brainId: string): Promise<void> {
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

export function register(program: Command): Command {
  const cmd = registerCommand(program, {
    name: "brain",
    description: "Manage brains",
  });
  cmd.command("list").description("List all brains").action(listBrains);
  cmd
    .command("create <name> [seed]")
    .description("Create a new brain from a free-form seed")
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
  return cmd;
}
