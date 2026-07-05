import { dirname, join, resolve } from "path";
import { z, ZodError } from "zod";
import { homedir } from "os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { logger } from "@/utils/logger";

export const brainboxRoot = process.env["BRAINBOX_ROOT_PATH"]
  ? resolve(process.cwd(), process.env["BRAINBOX_ROOT_PATH"])
  : join(homedir(), ".brainbox");

// ponytail: add a file → define a zod schema with .default() values + one parseConfigFile() call.
// ponytail: add a key → add the field + its default to the schema. That's it.
export function parseConfigFile<T>(
  file: string,
  options: { header?: string; schema: z.ZodType<T> },
): T {
  const path = join(brainboxRoot, file);
  const defaults = defaultsFromSchema(options.schema);
  const templateStr =
    (options.header ? options.header + "\n" : "") +
    (defaults === undefined ? "" : stringifyYaml(defaults));
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, templateStr);
    raw = defaults ?? {};
  }
  try {
    return options.schema.parse(raw);
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

function defaultsFromSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  return extractDefaults(json);
}

function extractDefaults(node: unknown): unknown {
  if (!node || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  if ("default" in obj) return obj.default;
  if (
    obj.type === "object" &&
    obj.properties &&
    typeof obj.properties === "object"
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      obj.properties as Record<string, unknown>,
    )) {
      const d = extractDefaults(v);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}
