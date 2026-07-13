import type Supermemory from "supermemory";
import { logger } from "@/utils/logger";
import type { FactInput, FactMetadata, SearchHit, Space } from "./types";

const log = logger.child("memory");

export class Memory {
  constructor(
    public db: Supermemory,
    public space: Space,
  ) {
    log.debug(`Memory constructed for space=${space.name}`);
  }

  // ---------------------------------------------------------------------------
  // Memory primitives — thin wrappers over supermemory's `documents` API.
  //
  //   containerTag = space.name
  //   customId     = the stable lookup key (e.g. "daily-schedule:2026-06-10")
  //   content      = the fact text or JSON-encoded schedule
  //   metadata     = filterable bag: { kind, source, ... }
  // ---------------------------------------------------------------------------

  async add(input: FactInput): Promise<{ id: string }> {
    log.debug(
      `add: customId=${input.customId} kind=${input.metadata?.["kind"] ?? "-"} bytes=${input.content.length}`,
    );
    const response = await this.db.documents.add({
      content: input.content,
      containerTag: this.space.name,
      customId: input.customId,
      metadata: input.metadata,
    });
    log.debug(`add: stored id=${response.id}`);
    return { id: response.id };
  }

  async get(
    customId: string,
  ): Promise<{ content: string; metadata: FactMetadata | null } | null> {
    log.debug(`get: customId=${customId}`);
    const limit = 100;
    // ponytail: no get-by-customId API — page until found or exhausted.
    for (let page = 1; page <= 50; page += 1) {
      const listed = await this.db.documents.list({
        containerTags: [this.space.name],
        limit,
        page,
      });
      const memories = listed.memories ?? [];
      const match = memories.find((m) => m.customId === customId);
      if (match) {
        const full = await this.db.documents.get(match.id);
        log.debug(
          `get: hit customId=${customId} bytes=${full.content?.length ?? 0} page=${page}`,
        );
        return {
          content: full.content ?? "",
          metadata: (full.metadata ?? null) as FactMetadata | null,
        };
      }
      if (memories.length < limit) break;
    }
    log.debug(`get: miss for customId=${customId}`);
    return null;
  }

  async clear(): Promise<void> {
    log.debug(`clear: deleting all docs in space=${this.space.name}`);
    await this.db.documents.deleteBulk({ containerTags: [this.space.name] });
    log.debug(`clear: done`);
  }

  async list(): Promise<Array<{ customId: string | null; content: string }>> {
    log.debug(`list: paginating docs in space=${this.space.name}`);
    const limit = 100;
    const docs: Array<{ customId: string | null; content: string }> = [];
    for (let page = 1; page <= 50; page += 1) {
      const listed = await this.db.documents.list({
        containerTags: [this.space.name],
        limit,
        page,
      });
      const memories = listed.memories ?? [];
      for (const d of memories) {
        docs.push({ customId: d.customId, content: d.content ?? "" });
      }
      if (memories.length < limit) break;
    }
    log.debug(`list: got ${docs.length} docs`);
    return docs;
  }

  async search(query: string, limit = 5): Promise<SearchHit[]> {
    log.debug(`search: q="${query}" limit=${limit} space=${this.space.name}`);
    const response = await this.db.search.execute({
      q: query,
      containerTag: this.space.name,
      limit,
      onlyMatchingChunks: true,
    });
    const hits = (response.results ?? []).map((r) => {
      const firstChunk = r.chunks?.[0];
      return {
        content: firstChunk?.content ?? "",
        score: r.score,
      };
    });
    log.debug(`search: ${hits.length} hits`);
    return hits;
  }
}
