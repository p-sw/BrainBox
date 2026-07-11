import { dirname, join, resolve } from "path";
import { z, ZodError } from "zod";
import { homedir } from "os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { logger } from "@/utils/logger";

export const brainboxRoot = process.env["BRAINBOX_ROOT_PATH"]
  ? resolve(process.cwd(), process.env["BRAINBOX_ROOT_PATH"])
  : join(homedir(), ".brainbox");

export interface ConfigFile<T> {
  path(): string;
  read(): T;
  write(value: T): void;
  update(fn: (current: T) => T): T;
}

export interface ConfigFileOptions<T> {
  schema: z.ZodType<T>;
  header?: string;
}

export function configFile<T>(
  file: string,
  options: ConfigFileOptions<T>,
): ConfigFile<T> {
  const path = (): string => join(brainboxRoot, file);
  const read = (): T => {
    const p = path();
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(p, "utf8")) ?? {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const defaults = defaultsFromSchema(options.schema);
      const templateStr =
        (options.header ? options.header + "\n" : "") +
        (defaults === undefined ? "" : stringifyYaml(defaults));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, templateStr);
      raw = defaults ?? {};
    }
    try {
      return options.schema.parse(raw);
    } catch (err) {
      if (err instanceof ZodError) {
        logger.error(
          `Invalid config in ${p}:\n` +
            err.issues
              .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("\n"),
        );
        process.exit(1);
      }
      throw err;
    }
  };
  const write = (value: T): void => {
    const p = path();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, stringifyYaml(value));
  };
  const update = (fn: (current: T) => T): T => {
    const next = fn(read());
    write(next);
    return next;
  };
  return { path, read, write, update };
}

export function parseConfigFile<T>(
  file: string,
  options: { header?: string; schema: z.ZodType<T> },
): T {
  return configFile(file, options).read();
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
