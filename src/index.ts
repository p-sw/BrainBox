#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logger } from "@/utils/logger";
import { run } from "@/commands/run";
import { brain } from "@/commands/brain";

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

const argv = process.argv;
const program = new Command();

program
  .name("brainbox")
  .description("A CLI tool for brainbox")
  .version(getVersion(), "-v, --version", "Display version number")
  .helpOption("-h, --help", "Display help for command")
  .configureOutput({
    outputError: (str) => logger.error(str.replace("error: ", "")),
  });

program.command("run").description("Run BrainBox").action(run);
program.command("brain").description("Manage brains").action(brain);

program.on("command:*", () => {
  logger.error(`Unknown command: ${program.args.join(" ")}`);
  program.help();
});

program.parse(argv);
