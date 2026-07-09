import { defineCommand } from "@/commands/daemon/commands";
import { BaseChannel } from "@/channel/base";
import { logger } from "@/utils/logger";

defineCommand<{ code: string }>({
  name: "pairing",
  handler: async ({ code }) => {
    logger.debug(`pairing handler: code="${code}"`);
    if (typeof code !== "string" || code.trim().length === 0) {
      logger.debug(`pairing handler: missing code argument`);
      return { ok: false, error: "missing pairing code" };
    }
    return await BaseChannel.completePairingByCode(code);
  },
});
