import { config } from "@/config";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { logger } from "@/utils/logger";

const log = logger.child("brain-manager");

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
  /** Primary chat language (e.g. "English", "Korean"). Missing on older brains. */
  language?: string;
  baseSystemPrompt: string;
  dndReplyProbability: number;
  startConversationCountThreshold: number;
  startConversationTimeThreshold: number;
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
    log.debug(`loadBrain: id=${brainId}`);
    const list = await this.readDB();
    const found = list.find((b) => b.brainId === brainId);
    log.debug(`loadBrain: ${found ? "hit" : "miss"} (db size=${list.length})`);
    return found;
  }

  async listBrains(): Promise<BrainList> {
    const list = await this.readDB();
    log.debug(`listBrains: count=${list.length}`);
    return list;
  }

  async saveBrain(brainId: string, brain: BrainItem): Promise<void> {
    log.debug(`saveBrain: id=${brainId} name=${brain.displayName}`);
    const list = await this.readDB();
    const idx = list.findIndex((b) => b.brainId === brainId);
    const op = idx >= 0 ? "update" : "insert";
    if (idx >= 0) list[idx] = brain;
    else list.push(brain);
    await this.writeDB(list);
    log.debug(`saveBrain: ${op} committed (db size=${list.length})`);
  }

  async listAvailableBrain(): Promise<BrainItemWithChannel[]> {
    const list = await this.readDB();
    const ready = list.filter((b) => this.isBrainReady(b));
    log.debug(
      `listAvailableBrain: ${ready.length}/${list.length} ready (channel-bound + activated)`,
    );
    return ready;
  }

  async deleteBrain(brainId: string): Promise<void> {
    log.debug(`deleteBrain: id=${brainId}`);
    const list = await this.readDB();
    const filtered = list.filter((b) => b.brainId !== brainId);
    if (filtered.length === list.length) {
      log.debug(`deleteBrain: no-op (id not in db)`);
      return;
    }
    await this.writeDB(filtered);
    log.debug(`deleteBrain: removed (db size=${filtered.length})`);
  }

  async isBrainAvailable(brainId: string): Promise<boolean> {
    const item = await this.loadBrain(brainId);
    const ok = item !== undefined && this.isBrainReady(item);
    log.debug(`isBrainAvailable: id=${brainId} → ${ok}`);
    return ok;
  }

  isBrainReady(item: BrainItem): item is BrainItemWithChannel {
    if (!item.activated) {
      log.debug(`isBrainReady: ${item.brainId} not activated`);
      return false;
    }
    switch (item.channel) {
      case "discord":
        if (!item.discord?.token) {
          log.debug(`isBrainReady: ${item.brainId} missing discord.token`);
          return false;
        }
        return true;
      case "telegram":
        if (!item.telegram?.token) {
          log.debug(`isBrainReady: ${item.brainId} missing telegram.token`);
          return false;
        }
        return true;
      default:
        log.debug(
          `isBrainReady: ${item.brainId} has no channel configured`,
        );
        return false;
    }
  }
}

export const brainManager = new BrainDBManager();
