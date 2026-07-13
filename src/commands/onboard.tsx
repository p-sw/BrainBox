import { useState } from "react";
import { Box, Text, render, type Instance } from "ink";
import type { Command } from "commander";
import chalk from "chalk";
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

function ok(msg: string): void {
  console.log(chalk.green(`✔ ${msg}`));
}

function info(msg: string): void {
  console.log(msg);
}

/** Clear terminal, optional status line, then mount the next ink screen. */
function show(
  active: { current: Instance },
  node: React.ReactElement,
  status?: string,
): void {
  active.current.unmount();
  console.clear();
  if (status) ok(status);
  active.current = render(node);
}

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

  // extras — complete in onSubmit so we never side-effect during render
  const nextField = stage.fields[0]!;
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
          if (remaining.length === 0) {
            setProviderAuth(stage.provider, values);
            onDone({ provider: stage.provider });
            return;
          }
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
  onDone: (model: string) => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  return (
    <Box flexDirection="column">
      <Text>{chalk.bold("Step 1/4")} — Default model (both slots)</Text>
      <Text dimColor>
        model name, or <Text color="cyan">{provider}/</Text>model — fine-tune
        later with <Text color="cyan">brainbox model</Text>
      </Text>
      <TextInput
        prompt={`${provider}/model> `}
        onSubmit={(raw) => {
          const value = raw.trim();
          if (!value) {
            setError("Model cannot be empty");
            return;
          }
          // model may contain `/` (e.g. org/model); only treat as full slot
          // when it already starts with this provider's prefix
          const prefix = `${provider}/`;
          const full = value.startsWith(prefix) ? value : `${prefix}${value}`;
          if (full === prefix) {
            setError("Model cannot be empty");
            return;
          }
          setModelSlot("identity", full);
          setModelSlot("conversation", full);
          onDone(full);
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
    | { kind: "name" }
    | { kind: "language"; displayName: string }
    | { kind: "gender"; displayName: string; language: string }
    | { kind: "seed"; displayName: string; language: string; gender: string }
  >({ kind: "name" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
            setStage({ kind: "language", displayName: v });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (stage.kind === "language") {
    return (
      <Box flexDirection="column">
        <Text>
          {chalk.bold("Step 3/4")} — Language for{" "}
          <Text color="cyan">{stage.displayName}</Text>
        </Text>
        <Text dimColor>↑↓ to move, type to filter, enter to select</Text>
        <Select
          prompt="language> "
          items={[
            "English",
            "Korean",
            "Japanese",
            "Chinese",
            "Spanish",
            "French",
            "German",
            "Portuguese",
            "Italian",
            "Russian",
            "Arabic",
            "Hindi",
            "Thai",
            "Vietnamese",
            "Indonesian",
          ]}
          onSelect={(language) => {
            setError(null);
            setStage({
              kind: "gender",
              displayName: stage.displayName,
              language,
            });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (stage.kind === "gender") {
    return (
      <Box flexDirection="column">
        <Text>
          {chalk.bold("Step 3/4")} — Gender for{" "}
          <Text color="cyan">{stage.displayName}</Text>
        </Text>
        <Text dimColor>↑↓ to move, type to filter, enter to select</Text>
        <Select
          prompt="gender> "
          items={["Female", "Male", "Non-binary", "Unspecified"]}
          onSelect={(gender) => {
            setError(null);
            setStage({
              kind: "seed",
              displayName: stage.displayName,
              language: stage.language,
              gender,
            });
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
        <Text color="cyan">{stage.displayName}</Text>{" "}
        <Text dimColor>({stage.language}, {stage.gender})</Text>
      </Text>
      <Text dimColor>
        One sentence about who they are. The model will expand it.
      </Text>
      {busy ? (
        <Text dimColor>
          {
            "Creating brain… (This can take few minutes depending on the model's response speed)"
          }
        </Text>
      ) : (
        <TextInput
          prompt="seed> "
          onSubmit={(raw) => {
            const seed = raw.trim();
            if (seed === "skip") {
              onDone({ brainId: "", displayName: stage.displayName });
              return;
            }
            if (!seed) {
              setError("Seed cannot be empty (or type 'skip')");
              return;
            }
            setBusy(true);
            setError(null);
            void Brain.create(stage.displayName, seed, {
              language: stage.language,
              gender: stage.gender,
            }).then((result) => {
              setBusy(false);
              if ("error" in result) {
                setError(
                  `Brain creation failed: ${result.error} (fix seed, or type 'skip')`,
                );
                return;
              }
              onDone({
                brainId: result.brainId,
                displayName: stage.displayName,
              });
            });
          }}
        />
      )}
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
  onDone: (status: string) => void;
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
              onDone("Skipped channel setup.");
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
        onSubmit={(raw) => {
          const target = raw.trim();
          void (async () => {
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
                discord: {
                  token: stage.token,
                  channelId: target || undefined,
                },
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
            onDone(
              `Bound ${displayName} → ${stage.kind_}${
                target ? ` (${target})` : " (pairing mode)"
              }`,
            );
          })();
        }}
      />
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

async function runOnboard(): Promise<void> {
  console.clear();
  info(`Welcome — let's get ${chalk.bold("brainbox")} ready.`);

  const providers = listProviderNames().slice().sort();
  const { promise, resolve } = Promise.withResolvers<void>();

  // ponytail: chain screens inline inside one promise — one terminal render
  // at a time keeps ink's stdin listeners sane (same pattern as model.tsx).
  // Only the LAST screen resolves — waitUntilExit would race with chained
  // re-renders and resolve after the first screen's unmount.
  const active = { current: null as unknown as Instance };

  active.current = render(
    <ProviderApp
      providers={providers}
      onDone={(p) => {
        show(
          active,
          <ModelApp
            provider={p.provider}
            onDone={(model) => {
              show(
                active,
                <SuperMemoryApp
                  onDone={() => {
                    show(
                      active,
                      <BrainApp
                        onDone={(b) => {
                          if (!b.brainId) {
                            active.current.unmount();
                            console.clear();
                            info("Skipped brain creation.");
                            resolve();
                            return;
                          }
                          show(
                            active,
                            <ChannelApp
                              brainId={b.brainId}
                              displayName={b.displayName}
                              onDone={(status) => {
                                active.current.unmount();
                                console.clear();
                                if (status.startsWith("Skipped")) info(status);
                                else ok(status);
                                resolve();
                              }}
                            />,
                            `Created brain "${b.displayName}" (${chalk.cyan(b.brainId)})`,
                          );
                        }}
                      />,
                      "Saved supermemory key to brainbox.yaml",
                    );
                  }}
                />,
                `Set identity + conversation model to ${model}`,
              );
            }}
          />,
          `Saved ${p.provider} to auth.yaml`,
        );
      }}
    />,
  );

  await promise;

  ok("Onboarding complete.");
  info(`Run ${chalk.cyan("brainbox daemon")} to bring it online.`);
}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "onboard",
    description: "Interactively initialize the brainbox project",
    configure: (cmd) => cmd.action(runOnboard),
  });
}
