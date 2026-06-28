import { config } from "@/config";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";

export interface BrainItem {
  brainId: string;
  spaceName: string;
  displayName: string;
  baseSystemPrompt: string;
  activated: boolean;
}
export type BrainList = BrainItem[];

// Layout:
//   <root>/brains.json                 — BrainItem[] index, mirror
//   <root>/<brainId>/brain.json        — BrainItem per brain, source of truth

export class BrainDBManager {
  constructor(private readonly root: string = config.brainboxRoot) {}

  private brainDir(brainId: string): string {
    return join(this.root, brainId);
  }

  private brainFile(brainId: string): string {
    return join(this.brainDir(brainId), "brain.json");
  }

  private indexFile(): string {
    return join(this.root, "brains.json");
  }

  private async readIndex(): Promise<BrainList> {
    try {
      const content = await readFile(this.indexFile(), { encoding: "utf-8" });
      return JSON.parse(content) as BrainList;
    } catch {
      return [];
    }
  }

  private async writeIndex(list: BrainList): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.indexFile(), JSON.stringify(list, null, 2), {
      encoding: "utf-8",
    });
  }

  private async writeBrain(brain: BrainItem): Promise<void> {
    await mkdir(this.brainDir(brain.brainId), { recursive: true });
    await writeFile(
      this.brainFile(brain.brainId),
      JSON.stringify(brain, null, 2),
      { encoding: "utf-8" },
    );
  }

  async loadBrain(brainId: string): Promise<BrainItem | undefined> {
    try {
      const content = await readFile(this.brainFile(brainId), {
        encoding: "utf-8",
      });
      return JSON.parse(content) as BrainItem;
    } catch {
      return undefined;
    }
  }

  async saveBrain(brainId: string, brain: BrainItem): Promise<void> {
    await this.writeBrain(brain);
    const list = await this.readIndex();
    const idx = list.findIndex((b) => b.brainId === brainId);
    if (idx >= 0) list[idx] = brain;
    else list.push(brain);
    await this.writeIndex(list);
  }

  async listBrain(): Promise<Array<{ brainId: string; displayName: string }>> {
    const list = await this.readIndex();
    return list.map(({ brainId, displayName }) => ({ brainId, displayName }));
  }

  async deleteBrain(brainId: string): Promise<void> {
    await rm(this.brainDir(brainId), { recursive: true, force: true });
    const list = await this.readIndex();
    const filtered = list.filter((b) => b.brainId !== brainId);
    if (filtered.length === list.length) return;
    await this.writeIndex(filtered);
  }

  async isBrainAvailable(brainId: string): Promise<boolean> {
    return (await this.loadBrain(brainId)) !== undefined;
  }
}

export const brainManager = new BrainDBManager();
