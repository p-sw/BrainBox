import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { config } from "@/config";
import { logger } from "@/utils/logger";

export const DAEMON_SOCKET_PATH = join(config.brainboxRoot, "daemon.sock");

export interface DaemonResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  [key: string]: unknown;
}

/**
 * Send one JSON-line command to the daemon and return the parsed reply.
 *
 * Error policy: any failure — socket connect error, malformed reply, or a
 * `{ok:false, error:"..."}` reply — is logged via the shared logger and the
 * process is terminated via `process.exit(1)`. Callers can rely on the
 * returned `Promise` resolving only with a successful reply.
 */
export async function sendToDaemon<
  T extends DaemonResponse = DaemonResponse,
>(payload: { command: string; args?: unknown }): Promise<T> {
  logger.debug(
    `sendToDaemon: command="${payload.command}" args=${JSON.stringify(payload.args) ?? "null"}`,
  );
  let reply: T;
  try {
    reply = await exchangeOnce<T>(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(
      `Could not reach the daemon at ${DAEMON_SOCKET_PATH} (is it running?): ${reason}`,
    );
    process.exit(1);
  }
  logger.debug(
    `sendToDaemon: command="${payload.command}" reply ok=${reply.ok}`,
  );
  if (!reply.ok) {
    logger.error(reply.error ?? `daemon command "${payload.command}" failed`);
    process.exit(1);
  }
  return reply;
}

const RPC_TIMEOUT_MS = 15_000;

function exchangeOnce<T>(payload: object): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const socket: Socket = connect(DAEMON_SOCKET_PATH);
  let buf = "";
  let settled = false;
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.destroy();
    fn();
  };
  const timer = setTimeout(() => {
    finish(() =>
      reject(new Error(`daemon RPC timed out after ${RPC_TIMEOUT_MS}ms`)),
    );
  }, RPC_TIMEOUT_MS);
  socket.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx = buf.indexOf("\n");
    while (idx >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      idx = buf.indexOf("\n");
      if (line.length === 0) continue;
      try {
        finish(() => resolve(JSON.parse(line) as T));
      } catch (parseErr) {
        logger.debug(
          `exchangeOnce: invalid daemon reply: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        );
        finish(() => reject(new Error("invalid response from daemon")));
      }
      return;
    }
  });
  socket.on("error", (err) => {
    logger.debug(`exchangeOnce: socket error: ${err.message}`);
    finish(() => reject(err));
  });
  socket.on("close", () => {
    finish(() => reject(new Error("daemon closed connection without a reply")));
  });
  socket.write(JSON.stringify(payload) + "\n");
  return promise;
}
