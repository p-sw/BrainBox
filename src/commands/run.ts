import type { Command } from "commander";
import { registerCommand } from "@/commands";

export async function run() {}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "run",
    description: "Run BrainBox",
  }).action(run);
}
