import { defineCommand } from "@/commands/daemon/commands";
import { BaseChannel } from "@/channel/base";
import { startChannels } from "@/commands/daemon";
import { logger } from "@/utils/logger";

defineCommand({
  name: "restart",
  handler: async () => {
    const before = BaseChannel.all().length;
    logger.info(`Restart: shutting down ${before} active channel(s)`);
    await BaseChannel.shutdownAll();
    const started = await startChannels();
    logger.success(`Restart: ${started} channel(s) back up`);
    return { ok: true, result: { restarted: started } };
  },
});
