#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logger } from "@/utils/logger";
import { config } from "@/config";
import { register as daemon } from "@/commands/daemon";
import { register as brain } from "@/commands/brain";
import { register as pairing } from "@/commands/pairing";
import { register as restart } from "@/commands/restart";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ponytail: one line to translate the user-facing `debug: true` flag in
// brainbox.yaml into the logger's internal level. The level is the only thing
// debug mode changes — no separate stream, no extra format.
logger.configure({ level: config.debug ? "debug" : "info" });
logger.debug(
  `brainbox starting (debug=${config.debug}, root=${config.brainboxRoot})`,
);

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

daemon(program);
brain(program);
pairing(program);
restart(program);

program.on("command:*", () => {
  logger.error(`Unknown command: ${program.args.join(" ")}`);
  program.help();
});

program.parseAsync(argv);
