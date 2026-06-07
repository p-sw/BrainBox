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
const EXTRACTED_FACTS: Array<{
  statement: string;
  summary: string;
  source: string;
  confidence: number;
  topics: Array<{
    name: string;
    category: string;
    granularity: string;
    role: string;
  }>;
}> = [
  {
    statement: "Maren is 34 years old.",
    summary: "Maren is 34 years old.",
    source: "persona-init",
    confidence: 1.0,
    topics: [
      {
        name: "maren-age",
        category: "temporal",
        granularity: "concrete",
        role: "attribute",
      },
    ],
  },
  {
    statement: "Maren is a night-shift nurse.",
    summary: "Maren is a night-shift nurse.",
    source: "persona-init",
    confidence: 1.0,
    topics: [
      {
        name: "maren-occupation",
        category: "entity",
        granularity: "concrete",
        role: "attribute",
      },
    ],
  },
];

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
  if (options.jsonSchemaName === "fact-extractor") {
    return { items: EXTRACTED_FACTS } as unknown as T;
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
    dbPath: ":memory:",
    braindbPath: "/tmp/brainbox-test-braindb-debug-brain-IGNORED.json",
  },
}));

const { runDebugBrainInit } = await import("./brain");

beforeEach(() => {
  llmCalls.length = 0;
  mockCall.mockClear();
});

afterEach(async () => {
  const tmpFiles = readdirSync(tmpdir()).filter((f) =>
    f.startsWith("brainbox-debug-brain-"),
  );
  for (const f of tmpFiles) {
    try {
      const { unlink } = await import("fs/promises");
      await unlink(`${tmpdir()}/${f}`);
    } catch {}
  }
});

describe("runDebugBrainInit", () => {
  test("B1: returns ok result with brainId, spaceName, baseSystemPrompt, and uses the supplied seed", async () => {
    const result = await runDebugBrainInit({
      displayName: "Maren",
      seed: "Maren, 34, night-shift nurse, hides exhaustion behind sarcasm",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.kind).toBe("init");
    expect(result.displayName).toBe("Maren");
    expect(result.brainId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.spaceName).toBe(`brain:${result.brainId}`);

    expect(result.baseSystemPrompt).toContain(GENERATED_BASE_SYSTEM_PROMPT);
    expect(result.baseSystemPrompt).toContain("You exist in a text chat.");
    expect(result.baseSystemPrompt).toBe(
      `${GENERATED_BASE_SYSTEM_PROMPT}\n\n` +
        result.baseSystemPrompt.slice(
          GENERATED_BASE_SYSTEM_PROMPT.length + 2,
        ),
    );
  });

  test("B2: invokes the LLM exactly 3 times — PERSONA_INIT, PERSONA_BASE_SYSTEM_PROMPT, fact-extractor", async () => {
    await runDebugBrainInit({
      displayName: "Test",
      seed: "a seed",
    });

    expect(llmCalls.length).toBe(3);

    const initCall = llmCalls[0]!;
    expect(initCall.options.message).toBe("a seed");
    expect(initCall.options.jsonSchemaName).toBeUndefined();

    const systemCall = llmCalls[1]!;
    expect(systemCall.options.jsonSchemaName).toBeUndefined();
    expect(systemCall.options.message).toBe(PERSONA_DESCRIPTION);

    const factCall = llmCalls[2]!;
    expect(factCall.options.jsonSchemaName).toBe("fact-extractor");
    expect(factCall.options.message).toBe(PERSONA_DESCRIPTION);
  });

  test("B3: writes no real on-disk state — no brainbox.db, no brainbox.json, no leftover temp braindb in /tmp", async () => {
    const cwd = process.cwd();

    const beforeDb = existsSync(`${cwd}/brainbox.db`);
    const beforeJson = existsSync(`${cwd}/brainbox.json`);
    const beforeTmp = readdirSync(tmpdir()).filter((f) =>
      f.startsWith("brainbox-debug-brain-"),
    );

    await runDebugBrainInit({ displayName: "NoDiskCheck", seed: "x" });

    const afterDb = existsSync(`${cwd}/brainbox.db`);
    const afterJson = existsSync(`${cwd}/brainbox.json`);
    const afterTmp = readdirSync(tmpdir()).filter((f) =>
      f.startsWith("brainbox-debug-brain-"),
    );

    expect(afterDb).toBe(beforeDb);
    expect(afterJson).toBe(beforeJson);
    expect(afterTmp).toHaveLength(0);
  });

  test("B4: when Brain.create returns null (e.g. LLM throws), result is {ok: false, error}", async () => {
    mockCall.mockImplementationOnce(async () => {
      throw new Error("simulated LLM failure on PERSONA_INIT");
    });

    const result = await runDebugBrainInit({
      displayName: "Doomed",
      seed: "x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected !ok");
    expect(result.error).toMatch(/Brain initialization failed/);
  });

  test("B5: with no DB_PATH / BRAINDB_PATH env, runDebugBrainInit still works (no env dependency)", async () => {
    const result = await runDebugBrainInit({
      displayName: "EnvFree",
      seed: "no env",
    });
    expect(result.ok).toBe(true);
  });
});
