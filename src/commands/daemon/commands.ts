// ponytail: registry for remote commands received over the daemon's unix socket.
// Wire a command by calling defineCommand() from the command module's top level.

import { logger } from "@/utils/logger";

const log = logger.child("daemon-cmd");

export interface CommandResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

export type CommandHandler<TArgs = unknown> = (
  args: TArgs,
) => Promise<CommandResult> | CommandResult;

interface CommandEntry<TArgs = unknown> {
  name: string;
  handler: CommandHandler<TArgs>;
}

const registry = new Map<string, CommandEntry<unknown>>();

export function defineCommand<TArgs>(config: {
  name: string;
  handler: CommandHandler<TArgs>;
}): void {
  log.debug(`defineCommand: registered "${config.name}"`);
  registry.set(config.name, config as CommandEntry<unknown>);
}

export async function dispatch(payload: unknown): Promise<CommandResult> {
  if (typeof payload !== "object" || payload === null) {
    log.debug(`dispatch: payload not an object`);
    return { ok: false, error: "expected object" };
  }
  const { command, args } = payload as { command?: unknown; args?: unknown };
  if (typeof command !== "string" || command.length === 0) {
    log.debug(`dispatch: missing/empty command field`);
    return { ok: false, error: "missing command" };
  }
  const entry = registry.get(command);
  if (!entry) {
    log.debug(`dispatch: unknown command "${command}"`);
    return { ok: false, error: `unknown command: ${command}` };
  }
  log.debug(`dispatch: "${command}" → handler (args type=${typeof args})`);
  try {
    return await entry.handler(args);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.debug(`dispatch: "${command}" threw: ${reason}`);
    return { ok: false, error: reason };
  }
}