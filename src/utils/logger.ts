import chalk, { type ChalkInstance } from "chalk";
import { appendFileSync, existsSync, mkdirSync, createWriteStream, type WriteStream } from "fs";
import { dirname } from "path";
import { config } from "@/config";

export type LogLevel = "debug" | "info" | "success" | "warn" | "error" | "fatal";

const LEVELS: Record<LogLevel, { rank: number; color: ChalkInstance; stderr: boolean }> = {
  debug:   { rank: 0, color: chalk.gray,       stderr: false },
  info:    { rank: 1, color: chalk.blue,       stderr: false },
  success: { rank: 2, color: chalk.green,      stderr: false },
  warn:    { rank: 3, color: chalk.yellow,     stderr: true },
  error:   { rank: 4, color: chalk.red,        stderr: true },
  fatal:   { rank: 5, color: chalk.bgRed.white,stderr: true },
};

const ICONS: Record<LogLevel, string> = {
  debug:   "◆",
  info:    "ℹ",
  success: "✔",
  warn:    "⚠",
  error:   "✖",
  fatal:   "▲",
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

class Logger {
  private level: LogLevel;
  private timestamps: boolean;
  private colors: boolean;
  private tag?: string;
  private file?: string;
  private json: boolean;
  private silent: boolean;
  private fileStream?: WriteStream;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.timestamps = options.timestamps ?? true;
    this.colors = options.colors ?? chalk.level > 0;
    this.tag = options.tag;
    this.file = options.file;
    this.json = options.json ?? false;
    this.silent = options.silent ?? false;

    if (this.file) {
      const dir = dirname(this.file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.fileStream = createWriteStream(this.file, { flags: "a" });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level].rank >= LEVELS[this.level].rank;
  }

  private formatTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  private format(level: LogLevel, message: string): { console: string; file: string } {
    const ts = this.timestamps ? `[${this.formatTimestamp()}]` : "";
    const tag = this.tag ? `[${this.tag}]` : "";
    const icon = ICONS[level];
    const levelStr = level.toUpperCase();

    const consoleParts = [ts, tag, this.colors ? LEVELS[level].color(icon) : icon, message].filter(Boolean);
    const consoleLine = consoleParts.join(" ");

    const fileParts = [ts, tag, `[${levelStr}]`, message].filter(Boolean);
    const fileLine = fileParts.join(" ") + "\n";

    return { console: consoleLine, file: fileLine };
  }

  private formatJson(level: LogLevel, message: string): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      tag: this.tag,
      message,
    }) + "\n";
  }

  private write(level: LogLevel, message: string) {
    if (!this.shouldLog(level)) return;

    const { console: consoleLine, file: fileLine } = this.format(level, message);
    const jsonLine = this.formatJson(level, message);

    if (!this.silent) {
      const out = LEVELS[level].stderr ? process.stderr : process.stdout;
      out.write(consoleLine + "\n");
    }

    if (this.fileStream) {
      this.fileStream.write(this.json ? jsonLine : fileLine);
    }
  }

  debug(message: string)   { this.write("debug", message); }
  info(message: string)    { this.write("info", message); }
  success(message: string) { this.write("success", message); }
  warn(message: string)    { this.write("warn", message); }
  error(message: string)   { this.write("error", message); }
  fatal(message: string)   { this.write("fatal", message); }

  /** Create a child logger with an additional tag */
  child(tag: string): Logger {
    const combined = this.tag ? `${this.tag}:${tag}` : tag;
    return new Logger({
      level: this.level,
      timestamps: this.timestamps,
      colors: this.colors,
      tag: combined,
      file: this.file,
      json: this.json,
      silent: this.silent,
    });
  }

  /** Update options at runtime */
  configure(options: Partial<LoggerOptions>) {
    if (options.level !== undefined) this.level = options.level;
    if (options.timestamps !== undefined) this.timestamps = options.timestamps;
    if (options.colors !== undefined) this.colors = options.colors;
    if (options.tag !== undefined) this.tag = options.tag;
    if (options.silent !== undefined) this.silent = options.silent;
    if (options.json !== undefined) this.json = options.json;

    if (options.file !== undefined && options.file !== this.file) {
      this.fileStream?.end();
      this.file = options.file;
      if (this.file) {
        const dir = dirname(this.file);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.fileStream = createWriteStream(this.file, { flags: "a" });
      } else {
        this.fileStream = undefined;
      }
    }
  }

  /** Close file stream gracefully */
  close() {
    this.fileStream?.end();
  }
}

/** Default global logger instance */
export const logger = new Logger();

/** Create a new logger instance with custom options */
export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}

export type { Logger };
