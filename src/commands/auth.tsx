import { useState } from "react";
import { Box, Text, render } from "ink";
import type { Command } from "commander";
import { logger } from "@/utils/logger";
import { TextInput } from "@/ui/TextInput";
import { listProviderNames } from "@/provider/llm";
import {
  PROVIDER_EXTRA_FIELDS,
  readAuthFile,
  removeProviderAuth,
  setProviderAuth,
} from "@/config/file/auth";
import { registerCommand } from "@/commands";

type Stage =
  | { kind: "provider" }
  | { kind: "apiKey"; provider: string }
  | {
      kind: "extras";
      provider: string;
      fields: string[];
      values: Record<string, string>;
    };

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function ProviderPicker({
  providers,
  onSelect,
}: {
  providers: string[];
  onSelect: (provider: string) => void;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <TextInput
        prompt="provider: "
        onSubmit={(v) => onSelect(v.trim())}
      />
      <Text dimColor>
        matches ({providers.length}/{providers.length}):
      </Text>
      {providers.slice(0, 8).map((p) => (
        <Text key={p}>  - {p}</Text>
      ))}
      {providers.length > 8 && <Text dimColor>  ... and more</Text>}
    </Box>
  );
}

function AddApp({
  providers,
  initialProvider,
  onDone,
}: {
  providers: string[];
  initialProvider?: string;
  onDone: () => void;
}): React.ReactElement {
  const [stage, setStage] = useState<Stage>(
    initialProvider
      ? { kind: "apiKey", provider: initialProvider }
      : { kind: "provider" },
  );
  const [error, setError] = useState<string | null>(null);

  if (stage.kind === "provider") {
    return (
      <Box flexDirection="column">
        <Text>Select a provider to add:</Text>
        <Text dimColor>(Enter an exact provider name; see list below)</Text>
        <ProviderPicker
          providers={providers}
          onSelect={(p) => {
            if (!p) {
              setError("Provider name is required");
              return;
            }
            if (!providers.includes(p)) {
              setError(`Unknown provider "${p}"`);
              return;
            }
            setError(null);
            setStage({ kind: "apiKey", provider: p });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  if (stage.kind === "apiKey") {
    return (
      <Box flexDirection="column">
        <Text>
          Provider: <Text color="cyan">{stage.provider}</Text>
        </Text>
        <TextInput
          prompt={`${stage.provider} apiKey: `}
          onSubmit={(apiKey) => {
            const trimmed = apiKey.trim();
            if (!trimmed) {
              setError("apiKey cannot be empty");
              return;
            }
            const extras = PROVIDER_EXTRA_FIELDS[stage.provider] ?? [];
            if (extras.length === 0) {
              setProviderAuth(stage.provider, { apiKey: trimmed });
              logger.success(`Saved ${stage.provider} to auth.yaml`);
              onDone();
              return;
            }
            setError(null);
            setStage({
              kind: "extras",
              provider: stage.provider,
              fields: extras,
              values: { apiKey: trimmed },
            });
          }}
        />
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  // stage.kind === "extras"
  const nextField = stage.fields[0];
  if (!nextField) {
    // Should not render — extras onSubmit saves + onDone when remaining is empty.
    return <Text>Done.</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text>
        {stage.provider}: <Text color="cyan">{stage.values["apiKey"]}</Text>
      </Text>
      <Text>Optional fields remaining: {stage.fields.join(", ")}</Text>
      <TextInput
        prompt={`${nextField} (leave empty to skip): `}
        onSubmit={(raw) => {
          const value = raw.trim();
          const remaining = stage.fields.slice(1);
          const values: Record<string, string> = { ...stage.values };
          if (value) values[nextField] = value;
          if (remaining.length === 0) {
            setProviderAuth(stage.provider, values);
            logger.success(`Saved ${stage.provider} to auth.yaml`);
            onDone();
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

function ListApp(): React.ReactElement {
  const auth = readAuthFile();
  const names = Object.keys(auth).sort();
  if (names.length === 0) {
    return (
      <Text>
        No providers configured. Run <Text color="cyan">brainbox auth add</Text>{" "}
        to add one.
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>Configured providers ({names.length}):</Text>
      {names.map((name) => {
        const fields = auth[name] ?? {};
        const fieldList = Object.entries(fields)
          .map(
            ([k, v]) =>
              `${k}=${k === "apiKey" ? maskKey(String(v)) : String(v)}`,
          )
          .join(", ");
        return (
          <Text key={name}>
            {"  "}- <Text color="cyan">{name}</Text>: {fieldList}
          </Text>
        );
      })}
    </Box>
  );
}

function RemoveApp({
  providers,
  onDone,
}: {
  providers: string[];
  onDone: () => void;
}): React.ReactElement {
  const [picked, setPicked] = useState<string | null>(null);
  if (!picked) {
    return (
      <Box flexDirection="column">
        <Text>Select a provider to remove:</Text>
        <ProviderPicker
          providers={providers}
          onSelect={(p) => {
            if (!providers.includes(p)) {
              logger.error(`Provider "${p}" is not configured.`);
              process.exit(1);
            }
            setPicked(p);
          }}
        />
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>
        Confirm remove <Text color="cyan">{picked}</Text> (yes/no):
      </Text>
      <TextInput
        prompt="> "
        onSubmit={(v) => {
          if (v.trim().toLowerCase() !== "yes") {
            logger.info("Cancelled.");
            onDone();
            return;
          }
          removeProviderAuth(picked);
          logger.success(`Removed ${picked} from auth.yaml`);
          onDone();
        }}
      />
    </Box>
  );
}

async function runAdd(providerArg?: string): Promise<void> {
  const providers = listProviderNames().slice().sort();
  if (providerArg && !providers.includes(providerArg)) {
    logger.error(
      `Unknown provider "${providerArg}". Registered: ${providers.join(", ")}`,
    );
    process.exit(1);
  }
  const app = render(
    <AddApp
      providers={providers}
      initialProvider={providerArg}
      onDone={() => app.unmount()}
    />,
  );
  await app.waitUntilExit();
}

async function runList(): Promise<void> {
  const app = render(<ListApp />);
  // ponytail: list is read-only, no input needed — unmount on next tick.
  setImmediate(() => app.unmount());
  await app.waitUntilExit();
}

async function runRemove(): Promise<void> {
  const auth = readAuthFile();
  const configured = Object.keys(auth).sort();
  if (configured.length === 0) {
    logger.info("No providers configured. Nothing to remove.");
    return;
  }
  const app = render(
    <RemoveApp providers={configured} onDone={() => app.unmount()} />,
  );
  await app.waitUntilExit();
}

export function register(program: Command): Command {
  return registerCommand(program, {
    name: "auth",
    description: "Manage provider authentication in auth.yaml",
    configure: (cmd) => {
      cmd
        .command("add [provider]")
        .description("Add provider authentication (interactive)")
        .action(async (provider?: string) => {
          await runAdd(provider);
        });
      cmd
        .command("list")
        .description("List configured providers")
        .action(async () => {
          await runList();
        });
      cmd
        .command("remove")
        .alias("rm")
        .description("Remove provider authentication (interactive)")
        .action(async () => {
          await runRemove();
        });
      return cmd;
    },
  });
}