import { defineCommand } from "@/commands/daemon/commands";
import { BaseChannel, DO_ACTIONS, type DoAction } from "@/channel/base";
import { logger } from "@/utils/logger";

defineCommand<{ action: string; brainId: string }>({
  name: "do",
  handler: async (args) => {
    const action = args?.action;
    const brainId = args?.brainId;
    logger.debug(`do handler: action="${action}" brainId="${brainId}"`);
    if (
      typeof action !== "string" ||
      !DO_ACTIONS.includes(action as DoAction)
    ) {
      return {
        ok: false,
        error: `invalid action (expected one of: ${DO_ACTIONS.join(", ")})`,
      };
    }
    if (typeof brainId !== "string" || brainId.trim().length === 0) {
      return { ok: false, error: "missing brainId" };
    }
    const result = BaseChannel.forceDo(brainId.trim(), action as DoAction);
    if (!result.ok) return result;
    return {
      ok: true,
      result: {
        action,
        brainId: brainId.trim(),
        displayName: result.displayName,
      },
    };
  },
});
