import { defineCommand } from "@/commands/daemon/commands";
import { BaseChannel, VIEW_THINGS, type ViewThing } from "@/channel/base";
import { logger } from "@/utils/logger";

defineCommand<{ thing: string; brainId: string }>({
  name: "view",
  handler: async (args) => {
    const thing = args?.thing;
    const brainId = args?.brainId;
    logger.debug(`view handler: thing="${thing}" brainId="${brainId}"`);
    if (typeof thing !== "string" || !VIEW_THINGS.includes(thing as ViewThing)) {
      return {
        ok: false,
        error: `invalid thing (expected one of: ${VIEW_THINGS.join(", ")})`,
      };
    }
    if (typeof brainId !== "string" || brainId.trim().length === 0) {
      return { ok: false, error: "missing brainId" };
    }
    const result = await BaseChannel.view(brainId.trim(), thing as ViewThing);
    if (!result.ok) return result;
    return {
      ok: true,
      result: {
        thing,
        brainId: brainId.trim(),
        displayName: result.displayName,
        value: result.value,
      },
    };
  },
});
