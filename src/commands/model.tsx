import { useState } from "react";
import { Box, Text, render } from "ink";
import type { Command } from "commander";
import { logger } from "@/utils/logger";
import { TextInput } from "@/ui/TextInput";
import { listProviderNames } from "@/provider/llm";
import { readRootFile, setModelSlot, type ModelSlot } from "@/config/file/root";
import { registerCommand } from "@/commands";

type Slot = ModelSlot;

function ModelApp({
  slot,
  onDone,
}: {
  slot: Slot;
  onDone: () => void;
}): React.ReactElement {
  const root = readRootFile();
  const current = slot === "identity" ? root.identityModel : root.conversationModel;
  const [error, setError] = useState<string | null>(null);

  return (
    <Box flexDirection="column">
      <Text>
        Setting <Text color="cyan">{slot}</Text> model (current:{" "}
        <Text dimColor>{current || "(unset)"}</Text>)
      </Text>
      <Text dimColor>Enter as provider/model (e.g. openai/gpt-4o)</Text>
      <TextInput
        prompt={`${slot}> `}
        initialValue={current}
        onSubmit={(raw) => {
          const value = raw.trim();
          if (!value) {
            setError("Model cannot be empty");
            return;
          }
          const slash = value.indexOf("/");
          if (slash < 0) {
            setError('Must be in "provider/model" form');
            return;
          }
          const provider = value.slice(0, slash);
          const known = listProviderNames();
          if (!known.includes(provider)) {
            setError(`Unknown provider "${provider}"`);
            return;
          }
          setModelSlot(slot, value);
          logger.success(`Set ${slot} model to ${value}`);
          onDone();
        }}
      />
      {error && <Text color="red">{error}</Text>}
      <Text dimColor>
        Known providers: {listProviderNames().slice(0, 12).join(", ")}…
      </Text>
    </Box>
  );
}

function SlotPickerApp({
  onPick,
}: {
  onPick: (slot: Slot) => void;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>Select which model slot to set:</Text>
      <TextInput
        prompt="slot [identity|conversation]> "
        onSubmit={(v) => {
          const s = v.trim().toLowerCase();
          if (s !== "identity" && s !== "conversation") {
            logger.error(`Invalid slot "${s}". Expected identity or conversation.`);
            process.exit(1);
          }
          onPick(s);
        }}
      />
    </Box>
  );
}

async function runModel(slotArg?: string): Promise<void> {
  const slot = slotArg as Slot | undefined;
  if (slot && slot !== "identity" && slot !== "conversation") {
    logger.error(`Invalid slot "${slot}". Expected identity or conversation.`);
    process.exit(1);
  }

  if (slot) {
    const app = render(<ModelApp slot={slot} onDone={() => app.unmount()} />);
    await app.waitUntilExit();
    return;
  }

  // ponytail: chain the two screens by re-rendering inside the same promise —
  // one terminal render at a time keeps ink's stdin listeners sane.
  const { promise, resolve } = Promise.withResolvers<void>();
  let unmounted = false;
  let active = render(
    <SlotPickerApp
      onPick={(picked) => {
        active.unmount();
        if (unmounted) return;
        active = render(
          <ModelApp
            slot={picked}
            onDone={() => {
              active.unmount();
              resolve();
            }}
          />,
        );
      }}
    />,
  );
  void active.waitUntilExit().then(() => {
    unmounted = true;
    resolve();
  });
  await promise;
}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "model",
    description: "Set identity or conversation model (interactive)",
    configure: (cmd) =>
      cmd
        .argument("[slot]", "Model slot: identity or conversation")
        .action(async (slot?: string) => {
          await runModel(slot);
        }),
  });
}