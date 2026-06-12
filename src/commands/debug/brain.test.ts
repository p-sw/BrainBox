import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { tmpdir } from "os";

interface RecordedCall {
  model: unknown;
  options: {
    jsonSchemaName?: string;
    instruction?: string;
    message?: string;
  };
}

const llmCalls: RecordedCall[] = [];

const PERSONA_DESCRIPTION = "A 34yo night-shift nurse, hides exhaustion behind sarcasm.";
const GENERATED_BASE_SYSTEM_PROMPT =
  "You are Maren. You text in lowercase. You use '...' when tired.";

const mockCall = mock(async <T>(model: unknown, options: any): Promise<T> => {
  llmCalls.push({ model, options });
  if (
    options.instruction?.includes("depth psychologist") ||
    options.instruction?.includes("forensic biographer")
  ) {
    return PERSONA_DESCRIPTION as unknown as T;
  }
  if (
    options.instruction?.includes("prompt engineer") ||
    options.instruction?.includes("LLM character embodiment")
  ) {
    return GENERATED_BASE_SYSTEM_PROMPT as unknown as T;
  }
  throw new Error(
    `unexpected LLM call: model=${model} instruction=${options.instruction?.slice(0, 80)}`,
  );
});

mock.module("@/openrouter", () => ({
  llm: {
    models: { conversation: "test-conv", identity: "test-id" },
    call: mockCall,
  },
}));

mock.module("@/config", () => ({
  config: {
    openrouterApiKey: "test-key",
    supermemoryApiKey: "test-supermemory-key",
    braindbPath: "/tmp/brainbox-test-braindb-debug-brain-IGNORED.json",
  },
}));

const { runDebugBrainInit } = await import("./brain");

beforeEach(() => {
  llmCalls.length = 0;
  mockCall.mockClear();
});

afterEach(async () => {
  const { unlink } = await import("fs/promises");
  const tmpFiles = readdirSync(tmpdir()).filter((f) =>
    f.startsWith("brainbox-debug-brain-"),
  );
  for (const f of tmpFiles) {
    try {
      await unlink(`${tmpdir()}/${f}`);
    } catch {}
  }
});

describe("runDebugBrainInit", () => {
  test("B1: returns ok result with full description, baseSystemPrompt, storedFacts, and uses the supplied seed", async () => {
    const result = await runDebugBrainInit({
      displayName: "Maren",
      seed: "Maren, 34, night-shift nurse, hides exhaustion behind sarcasm",
      noSupermemory: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.kind).toBe("init");
    expect(result.displayName).toBe("Maren");
    expect(result.brainId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.spaceName).toBe(`brain:${result.brainId}`);

    expect(result.description).toBe(PERSONA_DESCRIPTION);

    expect(result.baseSystemPrompt).toContain(GENERATED_BASE_SYSTEM_PROMPT);
    expect(result.baseSystemPrompt).toContain("You exist in a text chat.");
    expect(result.baseSystemPrompt).toBe(
      `${GENERATED_BASE_SYSTEM_PROMPT}\n\n` +
        result.baseSystemPrompt.slice(
          GENERATED_BASE_SYSTEM_PROMPT.length + 2,
        ),
    );

    expect(result.storedFacts).toHaveLength(1);
    expect(result.storedFacts[0]!.customId).toBe("persona");
    expect(result.storedFacts[0]!.content).toContain(PERSONA_DESCRIPTION);

    expect(typeof result.elapsedMs).toBe("number");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("B2: invokes the LLM exactly 2 times — PERSONA_INIT and PERSONA_BASE_SYSTEM_PROMPT", async () => {
    await runDebugBrainInit({
      displayName: "Test",
      seed: "a seed",
      noSupermemory: true,
    });

    expect(llmCalls.length).toBe(2);

    const initCall = llmCalls[0]!;
    expect(initCall.options.message).toBe("a seed");
    expect(initCall.options.jsonSchemaName).toBeUndefined();

    const systemCall = llmCalls[1]!;
    expect(systemCall.options.jsonSchemaName).toBeUndefined();
    expect(systemCall.options.message).toBe(PERSONA_DESCRIPTION);
  });

  test("B3: writes no real on-disk state — no leftover temp braindb in /tmp, no stray files in cwd", async () => {
    const cwd = process.cwd();

    const beforeCwdEntries = readdirSync(cwd);
    const beforeTmp = readdirSync(tmpdir()).filter((f) =>
      f.startsWith("brainbox-debug-brain-"),
    );

    await runDebugBrainInit({ displayName: "NoDiskCheck", seed: "x", noSupermemory: true });

    const afterCwdEntries = readdirSync(cwd);
    const afterTmp = readdirSync(tmpdir()).filter((f) =>
      f.startsWith("brainbox-debug-brain-"),
    );

    expect(afterCwdEntries).toEqual(beforeCwdEntries);
    expect(afterTmp).toHaveLength(0);

    expect(existsSync(`${cwd}/brainbox.db`)).toBe(false);
    expect(existsSync(`${cwd}/brainbox.json`)).toBe(false);
  });

  test("B4: when Brain.create returns null (e.g. LLM throws), result is {ok: false, error}", async () => {
    mockCall.mockImplementationOnce(async () => {
      throw new Error("simulated LLM failure on PERSONA_INIT");
    });

    const result = await runDebugBrainInit({
      displayName: "Doomed",
      seed: "x",
      noSupermemory: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.error).toMatch(/Brain initialization failed/);
    expect(typeof result.elapsedMs).toBe("number");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("B5: with no BRAINDB_PATH env, runDebugBrainInit still works (no env dependency)", async () => {
    const result = await runDebugBrainInit({
      displayName: "EnvFree",
      seed: "no env",
      noSupermemory: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(typeof result.elapsedMs).toBe("number");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Removed: B6 and B7 (production path with `debug: true|false` option).
//
// Reason: `Brain.create` no longer accepts a `debug` option. The production
// path is now identical to the debug path — `Brain.create` always persists
// facts to supermemory and returns `{ brain, description, baseSystemPrompt }`
// (no `extractedFacts`). B1 already exercises the post-refactor production
// behavior end-to-end through `runDebugBrainInit`.
// ---------------------------------------------------------------------------
