import type { Command } from "commander";
import { registerCommand } from "@/commands";

export async function brain() {}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "brain",
    description: "Manage brains",
  }).action(brain);
}
