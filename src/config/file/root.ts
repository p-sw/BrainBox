import z from "zod";
import { configFile } from "../loader";

const RootConfigSchema = z.object({
  debug: z.boolean().default(false),
  supermemory: z.object({ apiKey: z.string().default("") }),
  conversationModel: z.string().default(""),
  identityModel: z.string().default(""),
});

export type RootConfig = z.infer<typeof RootConfigSchema>;
export type ModelSlot = "identity" | "conversation";

const rootCfg = configFile<RootConfig>("brainbox.yaml", {
  schema: RootConfigSchema,
});

export function readRootFile(): RootConfig {
  return rootCfg.read();
}
const SLOT_KEY: Record<ModelSlot, keyof RootConfig> = {
  identity: "identityModel",
  conversation: "conversationModel",
};

export function setModelSlot(slot: ModelSlot, value: string): RootConfig {
  return rootCfg.update((root) => ({ ...root, [SLOT_KEY[slot]]: value }));
}

export function setSupermemoryKey(key: string): RootConfig {
  return rootCfg.update((root) => ({
    ...root,
    supermemory: { ...root.supermemory, apiKey: key },
  }));
}
