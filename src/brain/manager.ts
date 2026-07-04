import { config } from "@/config";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

export type ChannelKeys = "discord" | "telegram";
export interface BrainDiscordConfig {
  token: string;
  channelId?: string;
}
export interface BrainTelegramConfig {
  token: string;
  chatId?: number;
}
export interface BrainItem {
  brainId: string;
  spaceName: string;
  displayName: string;
  baseSystemPrompt: string;
  dndReplyProbability: number;
  activated: boolean;
  channel?: ChannelKeys;
  discord?: BrainDiscordConfig;
  telegram?: BrainTelegramConfig;
}
export type BrainItemDiscord = Omit<BrainItem, "channel" | ChannelKeys> & {
  channel: "discord";
  discord: BrainDiscordConfig;
};
export type BrainItemTelegram = Omit<BrainItem, "channel" | ChannelKeys> & {
  channel: "telegram";
  telegram: BrainTelegramConfig;
};
export type BrainItemWithChannel = BrainItemDiscord | BrainItemTelegram;
export type BrainList = BrainItem[];

export class BrainDBManager {
  constructor(private readonly root: string = config.brainboxRoot) {}

  private dbFile(): string {
    return join(this.root, "brains.json");
  }

  private async readDB(): Promise<BrainList> {
    try {
      const content = await readFile(this.dbFile(), { encoding: "utf-8" });
      return JSON.parse(content) as BrainList;
    } catch {
      return [];
    }
  }

  private async writeDB(list: BrainList): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.dbFile(), JSON.stringify(list, null, 2), {
      encoding: "utf-8",
    });
  }

  async loadBrain(brainId: string): Promise<BrainItem | undefined> {
    const list = await this.readDB();
    return list.find((b) => b.brainId === brainId);
  }

  async saveBrain(brainId: string, brain: BrainItem): Promise<void> {
    const list = await this.readDB();
    const idx = list.findIndex((b) => b.brainId === brainId);
    if (idx >= 0) list[idx] = brain;
    else list.push(brain);
    await this.writeDB(list);
  }

  async listAvailableBrain(): Promise<BrainItemWithChannel[]> {
    return (await this.readDB()).filter((b) => this.isBrainReady(b));
  }

  async deleteBrain(brainId: string): Promise<void> {
    const list = await this.readDB();
    const filtered = list.filter((b) => b.brainId !== brainId);
    if (filtered.length === list.length) return;
    await this.writeDB(filtered);
  }

  async isBrainAvailable(brainId: string): Promise<boolean> {
    const item = await this.loadBrain(brainId);
    return item !== undefined && this.isBrainReady(item);
  }

  isBrainReady(item: BrainItem): item is BrainItemWithChannel {
    if (!item.activated) return false;
    switch (item.channel) {
      case "discord":
        return !!item.discord?.token;
      case "telegram":
        return !!item.telegram?.token;
      default:
        return false;
    }
  }
}

export const brainManager = new BrainDBManager();
