import { useState } from "react";
import { Box, Text, render } from "ink";
import type { Command } from "commander";
import chalk from "chalk";
import { logger } from "@/utils/logger";
import { TextInput } from "@/ui/TextInput";
import { Select } from "@/ui/Select";
import { listProviderNames } from "@/provider/llm";
import { registerCommand } from "@/commands";
import { PROVIDER_EXTRA_FIELDS, setProviderAuth } from "@/config/file/auth";
import { setModelSlot, setSupermemoryKey } from "@/config/file/root";
import { brainManager } from "@/brain/manager";
import { Brain } from "@/brain";

// ponytail: chain terminal screens by re-rendering inside one promise — same
// pattern as model.tsx, keeps ink's stdin listeners sane (one raw-mode at a time).

type ProviderStage =
  | { kind: "pick" }
  | { kind: "apiKey"; provider: string }
  | {
      kind: "extras";
      provider: string;
      fields: string[];
      values: Record<string, string>;
    };

function ProviderApp({
  providers,
  onDone,
}: {
  providers: string[];
  onDone: (ctx: { provider: string }) => void;
}): React.ReactElement {
  const [stage, setStage] = useState<ProviderStage>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);

  if (stage.kind === "pick") {
    return (
      <Box flexDirection="column">
        <Text>{chalk.bold("Step 1/4")} — Choose your first provider</Text>
        <Text dimColor>↑↓ to move, type to filter, enter to select</Text>
        <Select
          prompt="provider> "
          items={providers}
          onSelect={(p) => {
            setError(null);
            setStage({ kind: "apiKey", provider: p });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (stage.kind === "apiKey") {
    const envName = `${stage.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
    return (
      <Box flexDirection="column">
        <Text>
          {chalk.bold("Step 1/4")} — <Text color="cyan">{stage.provider}</Text>{" "}
          api key
        </Text>
        <Text dimColor>(blank reuses ${envName} from env)</Text>
        <TextInput
          prompt="apiKey> "
          onSubmit={(raw) => {
            const apiKey = raw.trim() || (process.env[envName] ?? "");
            if (!apiKey) {
              setError("apiKey cannot be empty");
              return;
            }
            const extras = PROVIDER_EXTRA_FIELDS[stage.provider] ?? [];
            if (extras.length === 0) {
              setProviderAuth(stage.provider, { apiKey });
              logger.success(`Saved ${stage.provider} to auth.yaml`);
              onDone({ provider: stage.provider });
              return;
            }
            setError(null);
            setStage({
              kind: "extras",
              provider: stage.provider,
              fields: extras,
              values: { apiKey },
            });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  // extras
  const nextField = stage.fields[0];
  if (!nextField) {
    setProviderAuth(stage.provider, stage.values);
    logger.success(`Saved ${stage.provider} to auth.yaml`);
    return <Text>Continuing…</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text>
        {chalk.bold("Step 1/4")} — {stage.provider} extra:{" "}
        <Text color="cyan">{nextField}</Text> (blank to skip)
      </Text>
      <TextInput
        prompt={`${nextField}> `}
        onSubmit={(raw) => {
          const value = raw.trim();
          const remaining = stage.fields.slice(1);
          const values: Record<string, string> = { ...stage.values };
          if (value) values[nextField] = value;
          setStage({
            kind: "extras",
            provider: stage.provider,
            fields: remaining,
            values,
          });
        }}
      />
    </Box>
  );
}

function ModelApp({
  provider,
  onDone,
}: {
  provider: string;
  onDone: () => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  return (
    <Box flexDirection="column">
      <Text>{chalk.bold("Step 1/4")} — Default model (both slots)</Text>
      <Text dimColor>
        e.g. <Text color="cyan">{provider}/</Text>model-name — fine-tune later
        with <Text color="cyan">brainbox model</Text>
      </Text>
      <TextInput
        prompt={`${provider}/model> `}
        onSubmit={(raw) => {
          const value = raw.trim();
          if (!value) {
            setError("Model cannot be empty");
            return;
          }
          if (!value.startsWith(`${provider}/`)) {
            setError(`Must start with "${provider}/"`);
            return;
          }
          setModelSlot("identity", value);
          setModelSlot("conversation", value);
          logger.success(`Set identity + conversation model to ${value}`);
          onDone();
        }}
      />
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

function SuperMemoryApp({
  onDone,
}: {
  onDone: () => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  return (
    <Box flexDirection="column">
      <Text>{chalk.bold("Step 2/4")} — Supermemory API key</Text>
      <Text dimColor>
        powers each brain's long-term memory. Blank reuses $SUPERMEMORY_API_KEY
        from env.
      </Text>
      <TextInput
        prompt="supermemory apiKey> "
        onSubmit={(raw) => {
          const key = raw.trim() || (process.env["SUPERMEMORY_API_KEY"] ?? "");
          if (!key) {
            setError("Supermemory API key cannot be empty");
            return;
          }
          setSupermemoryKey(key);
          logger.success("Saved supermemory key to brainbox.yaml");
          onDone();
        }}
      />
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

function BrainApp({
  onDone,
}: {
  onDone: (ctx: { brainId: string; displayName: string }) => void;
}): React.ReactElement {
  const [stage, setStage] = useState<
    { kind: "name" } | { kind: "seed"; displayName: string }
  >({ kind: "name" });
  const [error, setError] = useState<string | null>(null);

  if (stage.kind === "name") {
    return (
      <Box flexDirection="column">
        <Text>{chalk.bold("Step 3/4")} — Brain name</Text>
        <Text dimColor>The display name your channel will see</Text>
        <TextInput
          prompt="name> "
          onSubmit={(raw) => {
            const v = raw.trim();
            if (!v) {
              setError("Name cannot be empty");
              return;
            }
            setError(null);
            setStage({ kind: "seed", displayName: v });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>
        {chalk.bold("Step 3/4")} — Seed for{" "}
        <Text color="cyan">{stage.displayName}</Text>
      </Text>
      <Text dimColor>
        One sentence about who they are. The model will expand it.
      </Text>
      <TextInput
        prompt="seed> "
        onSubmit={async (raw) => {
          const seed = raw.trim();
          if (seed === "skip") {
            logger.info("Skipped brain creation.");
            onDone({ brainId: "", displayName: stage.displayName });
            return;
          }
          if (!seed) {
            setError("Seed cannot be empty (or type 'skip')");
            return;
          }
          const result = await Brain.create(stage.displayName, seed);
          if (!result) {
            setError(
              "Brain creation failed (check logs above, or type 'skip')",
            );
            return;
          }
          logger.success(
            `Created brain "${stage.displayName}" (${chalk.cyan(
              result.brainId,
            )})`,
          );
          onDone({ brainId: result.brainId, displayName: stage.displayName });
        }}
      />
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

type ChannelStage =
  | { kind: "kind" }
  | { kind: "token"; kind_: "discord" | "telegram" }
  | {
      kind: "target";
      kind_: "discord" | "telegram";
      token: string;
    };

function ChannelApp({
  brainId,
  displayName,
  onDone,
}: {
  brainId: string;
  displayName: string;
  onDone: () => void;
}): React.ReactElement {
  const [stage, setStage] = useState<ChannelStage>({ kind: "kind" });
  const [error, setError] = useState<string | null>(null);

  if (stage.kind === "kind") {
    return (
      <Box flexDirection="column">
        <Text>
          {chalk.bold("Step 4/4")} — Channel for{" "}
          <Text color="cyan">{displayName}</Text>
        </Text>
        <Text dimColor>↑↓ to move, type to filter, enter to select</Text>
        <Select
          prompt="channel> "
          items={["discord", "telegram", "skip"]}
          onSelect={(v) => {
            if (v === "skip") {
              logger.info("Skipped channel setup.");
              onDone();
              return;
            }
            setError(null);
            setStage({ kind: "token", kind_: v as "discord" | "telegram" });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (stage.kind === "token") {
    return (
      <Box flexDirection="column">
        <Text>
          {chalk.bold("Step 4/4")} — {stage.kind_} bot token
        </Text>
        <TextInput
          prompt="token> "
          onSubmit={(raw) => {
            const token = raw.trim();
            if (!token) {
              setError("Token cannot be empty");
              return;
            }
            setError(null);
            setStage({ kind: "target", kind_: stage.kind_, token });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  // target stage — optionally pre-bind channelId/chatId; blank defers to pairing
  return (
    <Box flexDirection="column">
      <Text>
        {chalk.bold("Step 4/4")} — Optional{" "}
        {stage.kind_ === "discord" ? "channelId" : "chatId"} (blank = pair
        later)
      </Text>
      <TextInput
        prompt={`${stage.kind_ === "discord" ? "channelId" : "chatId"}> `}
        onSubmit={async (raw) => {
          const target = raw.trim();
          const existing = await brainManager.loadBrain(brainId);
          if (!existing) {
            setError(`Brain ${brainId} no longer exists`);
            return;
          }
          let updated;
          if (stage.kind_ === "discord") {
            updated = {
              ...existing,
              channel: "discord" as const,
              discord: { token: stage.token, channelId: target || undefined },
              activated: true,
            };
          } else {
            const chatId = target ? Number(target) : undefined;
            if (target && Number.isNaN(chatId)) {
              setError("chatId must be a number");
              return;
            }
            updated = {
              ...existing,
              channel: "telegram" as const,
              telegram: { token: stage.token, chatId },
              activated: true,
            };
          }
          await brainManager.saveBrain(brainId, updated);
          logger.success(
            `Bound ${displayName} → ${stage.kind_}${
              target ? ` (${target})` : " (pairing mode)"
            }`,
          );
          onDone();
        }}
      />
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

async function runOnboard(): Promise<void> {
  logger.info(`Welcome — let's get ${chalk.bold("brainbox")} ready.`);

  const providers = listProviderNames().slice().sort();
  const { promise, resolve } = Promise.withResolvers<void>();

  // ponytail: chain screens inline inside one promise — one terminal render
  // at a time keeps ink's stdin listeners sane (same pattern as model.tsx).
  // Only the LAST screen resolves — waitUntilExit would race with chained
  // re-renders and resolve after the first screen's unmount.
  let active = render(
    <ProviderApp
      providers={providers}
      onDone={(p) => {
        active.unmount();
        active = render(
          <ModelApp
            provider={p.provider}
            onDone={() => {
              active.unmount();
              active = render(
                <SuperMemoryApp
                  onDone={() => {
                    active.unmount();
                    active = render(
                      <BrainApp
                        onDone={(b) => {
                          active.unmount();
                          if (!b.brainId) {
                            resolve();
                            return;
                          }
                          active = render(
                            <ChannelApp
                              brainId={b.brainId}
                              displayName={b.displayName}
                              onDone={() => {
                                active.unmount();
                                resolve();
                              }}
                            />,
                          );
                        }}
                      />,
                    );
                  }}
                />,
              );
            }}
          />,
        );
      }}
    />,
  );

  await promise;

  logger.success("Onboarding complete.");
  logger.info(`Run ${chalk.cyan("brainbox daemon")} to bring it online.`);
}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "onboard",
    description: "Interactively initialize the brainbox project",
    configure: (cmd) => cmd.action(runOnboard),
  });
}
