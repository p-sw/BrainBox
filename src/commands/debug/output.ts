import chalk from "chalk";
import ora, { type Ora } from "ora";

export function printSection(title: string): void {
  const line = "─".repeat(Math.max(40, title.length + 4));
  console.log(`\n┌${line}┐`);
  console.log(`│  ${title}`);
  console.log(`└${line}┘`);
}

export function printKeyValue(pairs: Record<string, string>): void {
  const labelWidth = Math.max(...Object.keys(pairs).map((k) => k.length));
  for (const [key, value] of Object.entries(pairs)) {
    console.log(`  ${key.padEnd(labelWidth)}  ${value}`);
  }
}

export class StepDriver {
  private readonly stepCount: number;
  private stepIndex = 0;
  private current: Ora | null = null;
  private currentLabel = "";

  constructor(stepCount: number) {
    this.stepCount = stepCount;
  }

  start(label: string): void {
    this.stepIndex += 1;
    this.resolvePrevious();
    this.currentLabel = label;
    const text = `Step ${this.stepIndex}/${this.stepCount}: ${label}`;
    this.current = ora(text).start();
  }

  done(summary: string): void {
    if (!this.current) return;
    const text = this.current.text;
    this.current.succeed(`${text} — ${summary}`);
    this.current = null;
  }

  fail(reason: string): void {
    if (!this.current) {
      console.log(`${chalk.red("✖")} ${this.currentLabel} — ${reason}`);
      return;
    }
    this.current.fail(`${this.current.text} — ${reason}`);
    this.current = null;
  }

  private resolvePrevious(): void {
    if (this.current) {
      this.current.stop();
      this.current = null;
    }
  }
}

export function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}
