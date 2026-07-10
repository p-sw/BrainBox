import z from "zod";
import { parseConfigFile } from "../loader";

const ProviderAuthSchema = z
  .object({
    apiKey: z.string().default(""),
  })
  .loose();

const AuthSchema = z.record(z.string(), ProviderAuthSchema);

const authConfig = parseConfigFile("auth.yaml", {
  schema: AuthSchema,
});

export default authConfig;
