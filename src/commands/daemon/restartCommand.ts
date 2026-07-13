import { defineCommand } from "@/commands/daemon/commands";
import { BaseChannel } from "@/channel/base";
import { startChannels } from "@/commands/daemon";
import { resetLlm } from "@/provider";
import { logger } from "@/utils/logger";

defineCommand({
  name: "restart",
  handler: async () => {
    const before = BaseChannel.all().length;
    logger.info(`Restart: shutting down ${before} active channel(s)`);
    logger.debug(`restart handler: tearing down ${before} active channel(s)`);
    await BaseChannel.shutdownAll();
    // Re-read auth/model slots on next LLM call after restart.
    resetLlm();
    const started = await startChannels();
    logger.success(`Restart: ${started} channel(s) back up`);
    return { ok: true, result: { restarted: started } };
  },
});
