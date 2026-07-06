import type { Command } from "commander";
import { registerCommand } from "@/commands";
import {
  brainManager,
  type BrainItemDiscord,
  type BrainItemTelegram,
} from "@/brain/manager";
import { Brain } from "@/brain";
import { DiscordChannel } from "@/channel/discord";
import { TelegramChannel } from "@/channel/telegram";
import { logger } from "@/utils/logger";
import { DAEMON_SOCKET_PATH } from "@/utils/daemonClient";
import { createServer, type Socket } from "node:net";
import { chmodSync, unlinkSync } from "node:fs";
import { dispatch } from "./daemon/commands";

import "./daemon/pairingCommand";

export async function daemon(): Promise<void> {
  const items = await brainManager.listAvailableBrain();
  if (items.length === 0) {
    logger.info("No activated brains with channels. Daemon idling.");
  }

  for (const item of items) {
    const brain = await Brain.load(item.brainId);
    if (!brain) continue;

    try {
      if (item.channel === "discord") {
        const channel = new DiscordChannel(brain as Brain<BrainItemDiscord>);
        await channel.init();
        logger.success(
          `Discord channel started: ${brain.brainbase.displayName}`,
        );
      } else if (item.channel === "telegram") {
        const channel = new TelegramChannel(brain as Brain<BrainItemTelegram>);
        await channel.init();
        logger.success(
          `Telegram channel started: ${brain.brainbase.displayName}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to start channel for "${brain.brainbase.displayName}" (${item.channel}): ${reason}`,
      );
    }
  }

  await listenOnSocket();
}

const SOCKET_PATH = DAEMON_SOCKET_PATH;

async function listenOnSocket(): Promise<void> {
  try {
    unlinkSync(SOCKET_PATH);
  } catch {
    // ponytail: stale socket from a prior crash — best-effort unlink
  }

  const sockets = new Set<Socket>();
  const server = createServer((conn) => {
    sockets.add(conn);
    conn.on("close", () => sockets.delete(conn));
    handleConnection(conn);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      chmodSync(SOCKET_PATH, 0o600);
      logger.success(`Daemon listening on unix://${SOCKET_PATH}`);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(SOCKET_PATH);
  });

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      for (const s of sockets) s.destroy();
      server.close(() => {
        try {
          unlinkSync(SOCKET_PATH);
        } catch {
          // ignore
        }
        resolve();
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  logger.info("Daemon shutting down.");
}

function handleConnection(conn: Socket): void {
  let buf = "";
  conn.setEncoding("utf8");
  conn.on("data", (chunk) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.length === 0) continue;
      void handleLine(conn, line);
    }
  });
  conn.on("error", (err) => {
    logger.debug(`Socket connection error: ${err.message}`);
  });
}

async function handleLine(conn: Socket, line: string): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    conn.write(JSON.stringify({ ok: false, error: "invalid json" }) + "\n");
    return;
  }
  const response = await dispatch(payload);
  conn.write(JSON.stringify(response) + "\n");
}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "daemon",
    description:
      "Run the BrainBox daemon (activated channels + remote commands)",
  }).action(daemon);
}
