import type { Command } from "commander";
import { registerCommand } from "@/commands";
import { logger } from "@/utils/logger";
import { sendToDaemon, type DaemonResponse } from "@/utils/daemonClient";

interface PairingResponse extends DaemonResponse {
  brainId?: string;
  displayName?: string;
}

export async function pair(code: string): Promise<void> {
  logger.debug(`pair: sending code "${code}" to daemon`);
  // ponytail: sendToDaemon logs and process.exit(1)s on any failure — no try/catch needed here.
  const response = await sendToDaemon<PairingResponse>({
    command: "pairing",
    args: { code },
  });
  logger.success(
    `Paired "${response.displayName ?? response.brainId}" successfully.`,
  );
}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "pairing",
    description: "Complete channel pairing with a pairing code",
    configure: (cmd) =>
      cmd.argument("<code>", "Pairing code issued by the channel").action(pair),
  });
}
