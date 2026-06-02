import { config } from "@/config";
import { IdentityDB, type Space } from "identitydb";
import { llm } from "@/openrouter";
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
  ): Promise<Brain | null> {}

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
