import { config } from "@/config";
import { readFile, writeFile } from "fs/promises";

export interface BrainItem {
  brainId: string;
  spaceName: string;
  displayName: string;
  baseSystemPrompt: string;
}
export type BrainDB = Record<string, BrainItem>;

export class BrainDBManager {
  constructor(private readonly braindbPath: string = config.braindbPath) {}

  private get db() {
    return readFile(this.braindbPath, { encoding: "utf-8" }).then(
      (content) => {
        return JSON.parse(content) as BrainDB;
      },
    );
  }

  private async writeDb(db: BrainDB) {
    await writeFile(this.braindbPath, JSON.stringify(db), {
      encoding: "utf-8",
    });
  }

  async loadBrain(brainId: string): Promise<BrainItem | undefined> {
    const brainOrNot = (await this.db)[brainId];
    return brainOrNot;
  }

  async saveBrain(brainId: string, brain: BrainItem) {
    const db = await this.db;
    db[brainId] = brain;
    await this.writeDb(db);
  }

  async listBrain() {
    return Object.entries(await this.db).map(
      ([_, { brainId, displayName }]) => ({ brainId, displayName }),
    );
  }

  async deleteBrain(brainId: string) {
    const db = await this.db;
    delete db[brainId];
    await this.writeDb(db);
  }

  async isBrainAvailable(brainId: string) {
    return brainId in (await this.db);
  }
}

export const brainManager = new BrainDBManager();
