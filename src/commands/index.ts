import type { Command } from "commander";

export interface CommandConfig {
  name: string;
  description: string;
  configure?: (cmd: Command) => void;
}

export function registerCommand(
  program: Command,
  config: CommandConfig,
): Command {
  const cmd = program.command(config.name).description(config.description);
  config.configure?.(cmd);
  return cmd;
}
