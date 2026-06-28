import z from "zod";
import { parseConfigFile } from "../loader";

const RootConfigSchema = z.object({
  openrouter: z.object({ apiKey: z.string().min(1) }),
  supermemory: z.object({ apiKey: z.string().min(1) }),
});

const rootConfig = parseConfigFile(
  "brainbox.yaml",
  {
    header: "# Fill in your API keys, then run brainbox again.",
    body: {
      openrouter: { apiKey: "" },
      supermemory: { apiKey: "" },
    },
  },
  RootConfigSchema,
);

export default rootConfig;
