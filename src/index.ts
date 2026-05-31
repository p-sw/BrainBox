#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logger } from "./utils/logger.js";
import { greet } from "./commands/greet.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function run(argv: string[] = process.argv) {
  const program = new Command();

  program
    .name("brainbox")
    .description("A CLI tool for brainbox")
    .version(getVersion(), "-v, --version", "Display version number")
    .helpOption("-h, --help", "Display help for command")
    .configureOutput({
      outputError: (str) => logger.error(str.replace("error: ", "")),
    });

  program
    .command("greet")
    .description("Greet someone")
    .argument("<name>", "Name to greet")
    .option("-u, --uppercase", "Convert greeting to uppercase")
    .option("-c, --count <number>", "Repeat the greeting", "1")
    .action(greet);

  program.on("command:*", () => {
    logger.error(`Unknown command: ${program.args.join(" ")}`);
    program.help();
  });

  program.parse(argv);
}

run();
