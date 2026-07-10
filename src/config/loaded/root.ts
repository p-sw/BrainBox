import z from "zod";
import { parseConfigFile } from "../loader";

const RootConfigSchema = z.object({
  debug: z.boolean().default(false),
  supermemory: z.object({ apiKey: z.string().default("") }),
  conversationModel: z.string().default(""),
  identityModel: z.string().default(""),
});

const rootConfig = parseConfigFile("brainbox.yaml", {
  schema: RootConfigSchema,
});

export default rootConfig;
