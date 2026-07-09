import type { Command } from "commander";
import { registerCommand } from "@/commands";
import { logger } from "@/utils/logger";
import { sendToDaemon, type DaemonResponse } from "@/utils/daemonClient";

interface RestartResponse extends DaemonResponse {
  result?: { restarted?: number };
}

export async function restart(): Promise<void> {
  // ponytail: sendToDaemon logs and process.exit(1)s on any failure — no try/catch needed.
  const response = await sendToDaemon<RestartResponse>({ command: "restart" });
  const count = response.result?.restarted ?? 0;
  logger.success(`Daemon restarted (${count} channel(s) re-initialised).`);
}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "restart",
    description: "Shutdown channels, reload configs/brain index, re-init",
    configure: (cmd) => cmd.action(restart),
  });
}
