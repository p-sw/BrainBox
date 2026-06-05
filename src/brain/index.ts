import { randomUUID } from "node:crypto";
import { config } from "@/config";
import { IdentityDB, type Space } from "identitydb";
import { llm } from "@/openrouter";
import { loadPrompt } from "@/openrouter/promptLoader";
import { logger } from "@/utils/logger";
import { factExtractor } from "./factExtractor";
import { brainManager, type BrainItem } from "./manager";

export class Brain {
  constructor(
    public db: IdentityDB,
    public space: Space,
    public brainbase: BrainItem,
  ) {}

  static async create(
    displayName: string,
    seed: string,
  ): Promise<Brain | null> {
    try {
      const personaInitInstruction = await loadPrompt("PERSONA_INIT");
      const description = await llm.call<string>(llm.models.identity, {
        instruction: personaInitInstruction,
        message: seed,
      });

      const personaSystemInstruction = await loadPrompt(
        "PERSONA_BASE_SYSTEM_PROMPT",
      );
      const baseSystemPrompt = await llm.call<string>(llm.models.identity, {
        instruction: personaSystemInstruction,
        message: description,
      });

      const db = await IdentityDB.connect({
        client: "sqlite",
        filename: config.dbPath,
      });
      await db.initialize();
      const brainId = randomUUID();
      const spaceName = `brain:${brainId}`;
      const space = await db.upsertSpace({
        name: spaceName,
        description: displayName,
      });

      await db.ingestStatement(description, {
        extractor: factExtractor,
        spaceName,
      });

      const brainbase: BrainItem = {
        brainId,
        spaceName,
        displayName,
        baseSystemPrompt,
      };
      await brainManager.saveBrain(brainId, brainbase);

      return new Brain(db, space, brainbase);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create brain "${displayName}": ${reason}`);
      return null;
    }
  }

  static async load(brainId: string): Promise<Brain | null> {
    const brain = await brainManager.loadBrain(brainId);
    if (!brain) return null;

    const db = await IdentityDB.connect({
      client: "sqlite",
      filename: config.dbPath,
    });

    const space = await db.getSpaceByName(brain.spaceName);
    if (!space) return null;

    return new Brain(db, space, brain);
  }
}
