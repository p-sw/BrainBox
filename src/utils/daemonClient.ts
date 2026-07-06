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
  if (!reply.ok) {
    logger.error(reply.error ?? `daemon command "${payload.command}" failed`);
    process.exit(1);
  }
  return reply;
}

function exchangeOnce<T>(payload: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(DAEMON_SOCKET_PATH);
    let buf = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };
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
        } catch {
          finish(() => reject(new Error("invalid response from daemon")));
        }
        return;
      }
    });
    socket.on("error", (err) => {
      finish(() => reject(err));
    });
    socket.write(JSON.stringify(payload) + "\n");
  });
}
