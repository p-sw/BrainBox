import chalk, { type ChalkInstance } from "chalk";
import { existsSync, mkdirSync, createWriteStream, type WriteStream } from "fs";
import { dirname } from "path";

export type LogLevel =
  | "debug"
  | "info"
  | "success"
  | "warn"
  | "error"
  | "fatal";

const LEVELS: Record<
  LogLevel,
  { rank: number; color: ChalkInstance; stderr: boolean }
> = {
  debug: { rank: 0, color: chalk.gray, stderr: false },
  info: { rank: 1, color: chalk.blue, stderr: false },
  success: { rank: 2, color: chalk.green, stderr: false },
  warn: { rank: 3, color: chalk.yellow, stderr: true },
  error: { rank: 4, color: chalk.red, stderr: true },
  fatal: { rank: 5, color: chalk.bgRed.white, stderr: true },
};

const ICONS: Record<LogLevel, string> = {
  debug: "◆",
  info: "ℹ",
  success: "✔",
  warn: "⚠",
  error: "✖",
  fatal: "▲",
};

export interface LoggerOptions {
  /** Minimum log level to output. Default: "info" */
  level?: LogLevel;
  /** Include timestamps. Default: true */
  timestamps?: boolean;
  /** Enable colors. Default: auto-detected from TTY */
  colors?: boolean;
  /** Tag prefix for all messages. Default: none */
  tag?: string;
  /** File path to append logs to. Default: none */
  file?: string;
  /** Write JSON lines to file instead of plain text. Default: false */
  json?: boolean;
  /** Completely suppress console output. Default: false */
  silent?: boolean;
}

// Process-wide sink: configure() and constructor options (except tag) apply to
// every Logger, including children created before configure runs.
const shared = {
  level: "info" as LogLevel,
  timestamps: true,
  colors: chalk.level > 0,
  file: undefined as string | undefined,
  fileStream: undefined as WriteStream | undefined,
  json: false,
  silent: false,
};

function openFile(path: string | undefined): void {
  if (path === shared.file) return;
  shared.fileStream?.end();
  shared.file = path;
  if (path) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    shared.fileStream = createWriteStream(path, { flags: "a" });
  } else {
    shared.fileStream = undefined;
  }
}

function applyShared(options: Partial<LoggerOptions>): void {
  if (options.level !== undefined) shared.level = options.level;
  if (options.timestamps !== undefined) shared.timestamps = options.timestamps;
  if (options.colors !== undefined) shared.colors = options.colors;
  if (options.silent !== undefined) shared.silent = options.silent;
  if (options.json !== undefined) shared.json = options.json;
  // `file: undefined` must clear the sink — use `in` so Partial can disable it.
  if ("file" in options) openFile(options.file);
}

class Logger {
  private tag?: string;

  constructor(options: LoggerOptions = {}) {
    this.tag = options.tag;
    applyShared(options);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level].rank >= LEVELS[shared.level].rank;
  }

  private formatTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  private format(
    level: LogLevel,
    message: string,
  ): { console: string; file: string } {
    const ts = shared.timestamps ? `[${this.formatTimestamp()}]` : "";
    const tag = this.tag ? `[${this.tag}]` : "";
    const icon = ICONS[level];
    const levelStr = level.toUpperCase();

    const consoleParts = [
      ts,
      tag,
      shared.colors ? LEVELS[level].color(icon) : icon,
      message,
    ].filter(Boolean);
    const consoleLine = consoleParts.join(" ");

    const fileParts = [ts, tag, `[${levelStr}]`, message].filter(Boolean);
    const fileLine = fileParts.join(" ") + "\n";

    return { console: consoleLine, file: fileLine };
  }

  private formatJson(level: LogLevel, message: string): string {
    return (
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        tag: this.tag,
        message,
      }) + "\n"
    );
  }

  private write(level: LogLevel, message: string) {
    if (!this.shouldLog(level)) return;

    const { console: consoleLine, file: fileLine } = this.format(
      level,
      message,
    );
    const jsonLine = this.formatJson(level, message);

    if (!shared.silent) {
      const out = LEVELS[level].stderr ? process.stderr : process.stdout;
      out.write(consoleLine + "\n");
    }

    if (shared.fileStream) {
      shared.fileStream.write(shared.json ? jsonLine : fileLine);
    }
  }

  debug(message: string) {
    this.write("debug", message);
  }
  info(message: string) {
    this.write("info", message);
  }
  success(message: string) {
    this.write("success", message);
  }
  warn(message: string) {
    this.write("warn", message);
  }
  error(message: string) {
    this.write("error", message);
  }
  fatal(message: string) {
    this.write("fatal", message);
  }

  child(tag: string): Logger {
    const combined = this.tag ? `${this.tag}:${tag}` : tag;
    // Tag only — level/file/json live in shared and stay process-wide.
    return new Logger({ tag: combined });
  }

  configure(options: Partial<LoggerOptions>) {
    if (options.tag !== undefined) this.tag = options.tag;
    applyShared(options);
  }

  close() {
    shared.fileStream?.end();
    shared.fileStream = undefined;
    shared.file = undefined;
  }
}

export const logger = new Logger();

export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}

export type { Logger };
