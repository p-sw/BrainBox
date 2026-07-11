import chalk, { type ChalkInstance } from "chalk";
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  writeFileSync,
  type WriteStream,
} from "fs";
import { join } from "path";

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
  /**
   * Directory for daily log files named `YYYY-MM-DD.log`.
   * A new file is opened when the local date rolls over. Default: none
   */
  logDir?: string;
  /** Write JSON lines to file instead of plain text. Default: false */
  json?: boolean;
  /** Completely suppress console output. Default: false */
  silent?: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Daily-rotated append-only file sink under `dir/YYYY-MM-DD.log`. */
class DailyFileSink {
  private dir: string | undefined;
  private date: string | undefined;
  private stream: WriteStream | undefined;

  setDir(dir: string | undefined): void {
    if (dir === this.dir) return;
    this.stream?.end();
    this.stream = undefined;
    this.date = undefined;
    this.dir = dir;
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  write(data: string): void {
    if (!this.dir) return;
    const today = dateKey();
    if (!this.stream || this.date !== today) {
      this.stream?.end();
      this.date = today;
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      this.stream = createWriteStream(join(this.dir, `${today}.log`), {
        flags: "a",
      });
    }
    this.stream.write(data);
  }

  close(): void {
    this.stream?.end();
    this.stream = undefined;
    this.date = undefined;
    this.dir = undefined;
  }

  get enabled(): boolean {
    return this.dir !== undefined;
  }
}

// Process-wide sink: configure() and constructor options (except tag) apply to
// every Logger, including children created before configure runs.
const shared = {
  level: "info" as LogLevel,
  timestamps: true,
  colors: chalk.level > 0,
  json: false,
  silent: false,
};

const mainSink = new DailyFileSink();
// File-only LLM exchanges — one file per request, never console.
let llmLogDir: string | undefined;

function applyShared(options: Partial<LoggerOptions>): void {
  if (options.level !== undefined) shared.level = options.level;
  if (options.timestamps !== undefined) shared.timestamps = options.timestamps;
  if (options.colors !== undefined) shared.colors = options.colors;
  if (options.silent !== undefined) shared.silent = options.silent;
  if (options.json !== undefined) shared.json = options.json;
  // `logDir: undefined` must clear the sink — use `in` so Partial can disable it.
  if ("logDir" in options) mainSink.setDir(options.logDir);
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
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
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

    if (mainSink.enabled) {
      mainSink.write(shared.json ? jsonLine : fileLine);
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
    // Tag only — level/logDir/json live in shared and stay process-wide.
    return new Logger({ tag: combined });
  }

  configure(options: Partial<LoggerOptions>) {
    if (options.tag !== undefined) this.tag = options.tag;
    applyShared(options);
  }

  close() {
    mainSink.close();
    llmLogDir = undefined;
  }
}

export const logger = new Logger();

export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}

/** Enable/disable the file-only per-request LLM log directory. */
export function configureLlmLog(logDir: string | undefined): void {
  llmLogDir = logDir;
  if (logDir && !existsSync(logDir)) mkdirSync(logDir, { recursive: true });
}

export function isLlmLogEnabled(): boolean {
  return llmLogDir !== undefined;
}

function sanitizeCaller(caller: string): string {
  const s = caller.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "unknown";
}

function dateTimeKey(d: Date = new Date()): string {
  return `${dateKey(d)}-${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

/**
 * Write one LLM exchange to
 * `<logDir>/YYYY-MM-DD-hh-mm-ss-<callerName>.log`. Never console.
 */
export function writeLlmExchange(caller: string, content: string): void {
  if (!llmLogDir) return;
  if (!existsSync(llmLogDir)) mkdirSync(llmLogDir, { recursive: true });
  const base = `${dateTimeKey()}-${sanitizeCaller(caller)}`;
  let path = join(llmLogDir, `${base}.log`);
  for (let n = 2; existsSync(path); n += 1) {
    path = join(llmLogDir, `${base}-${n}.log`);
  }
  writeFileSync(path, content, "utf8");
}

export type { Logger };
