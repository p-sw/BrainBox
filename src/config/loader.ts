import { dirname, join, resolve } from "path";
import { z, ZodError } from "zod";
import { homedir } from "os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { logger } from "@/utils/logger";

export const brainboxRoot = process.env["BRAINBOX_ROOT_PATH"]
  ? resolve(process.cwd(), process.env["BRAINBOX_ROOT_PATH"])
  : join(homedir(), ".brainbox");

// ponytail: add a file → define a zod schema + one parseConfigFile() call.
// ponytail: add a key → extend the schema, extend the template.body, add to Config + the mapping below.
// ponytail: keep template.body and the schema in sync by hand; replace with z.toJSONSchema → defaults when more than ~5 files.
export function parseConfigFile<T>(
  file: string,
  template: { header?: string; body: Record<string, unknown> },
  schema: z.ZodType<T>,
): T {
  const path = join(brainboxRoot, file);
  const templateStr =
    (template.header ? template.header + "\n" : "") +
    stringifyYaml(template.body);
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, templateStr);
    raw = template.body;
  }
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      logger.error(
        `Invalid config in ${path}:\n` +
          err.issues
            .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n"),
      );
      process.exit(1);
    } else {
      throw err;
    }
  }
}
