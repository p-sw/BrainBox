import { defineCommand } from "@/commands/daemon/commands";
import { BaseChannel } from "@/channel/base";

defineCommand<{ code: string }>({
  name: "pairing",
  handler: async ({ code }) => {
    if (typeof code !== "string" || code.trim().length === 0) {
      return { ok: false, error: "missing pairing code" };
    }
    return await BaseChannel.completePairingByCode(code);
  },
});
