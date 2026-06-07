import type { Command } from "commander";
import { registerCommand } from "@/commands";
import { addBrainSubcommand } from "./brain";
import { addScheduleSubcommand } from "./schedule";

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "debug",
    description:
      "Dry-run tools: exercise code paths without writing to the database or braindb",
    configure: (cmd) => {
      addScheduleSubcommand(cmd);
      addBrainSubcommand(cmd);
    },
  });
}
