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
import { config } from "@/config";
import { createServer, type Socket } from "node:net";
import { chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { dispatch } from "./daemon/commands";

import "./daemon/pairingCommand";
import "./daemon/restartCommand";

export async function startChannels(): Promise<number> {
  const items = await brainManager.listAvailableBrain();
  logger.debug(`startChannels: ${items.length} candidate(s)`);
  let started = 0;
  for (const item of items) {
    const brain = await Brain.load(item.brainId);
    if (!brain) {
      logger.debug(
        `startChannels: skip ${item.brainId} (Brain.load returned null)`,
      );
      continue;
    }
    try {
      if (item.channel === "discord") {
        const channel = new DiscordChannel(brain as Brain<BrainItemDiscord>);
        await channel.init();
        logger.success(
          `Discord channel started: ${brain.brainbase.displayName}`,
        );
        started += 1;
      } else if (item.channel === "telegram") {
        const channel = new TelegramChannel(brain as Brain<BrainItemTelegram>);
        await channel.init();
        logger.success(
          `Telegram channel started: ${brain.brainbase.displayName}`,
        );
        started += 1;
      } else {
        logger.debug(
          `startChannels: unknown channel type "${(item as { channel: string }).channel}" for ${(item as { brainId: string }).brainId}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to start channel for "${brain.brainbase.displayName}" (${item.channel}): ${reason}`,
      );
    }
  }
  logger.debug(`startChannels: ${started}/${items.length} started`);
  return started;
}

export async function daemon(): Promise<void> {
  const logDir = join(config.brainboxRoot, "logs");
  logger.configure({ logDir });
  logger.debug(`daemon: boot (logDir=${logDir})`);
  const started = await startChannels();
  if (started === 0) {
    logger.info("No activated brains with channels. Daemon idling.");
  }
  await listenOnSocket();
}

const SOCKET_PATH = DAEMON_SOCKET_PATH;

async function listenOnSocket(): Promise<void> {
  logger.debug(`listenOnSocket: unlinking stale socket at ${SOCKET_PATH}`);
  try {
    unlinkSync(SOCKET_PATH);
  } catch {
    // ponytail: stale socket from a prior crash — best-effort unlink
  }

  const sockets = new Set<Socket>();
  const server = createServer((conn) => {
    logger.debug(`listenOnSocket: new connection`);
    sockets.add(conn);
    conn.on("close", () => {
      logger.debug(`listenOnSocket: connection closed`);
      sockets.delete(conn);
    });
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
      logger.debug(`listenOnSocket: shutdown signal received`);
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
      logger.debug(`handleConnection: received line (${line.length} chars)`);
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
    logger.debug(`handleLine: invalid json, replying with error`);
    conn.write(JSON.stringify({ ok: false, error: "invalid json" }) + "\n");
    return;
  }
  const cmd = (payload as { command?: string }).command;
  logger.debug(`handleLine: dispatching command="${cmd ?? "?"}"`);
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
