import type Supermemory from "supermemory";
import type { FactInput, FactMetadata, SearchHit, Space } from "./types";

export class Memory {
  constructor(
    public db: Supermemory,
    public space: Space,
  ) {}

  // ---------------------------------------------------------------------------
  // Memory primitives — thin wrappers over supermemory's `documents` API.
  //
  //   containerTag = space.name
  //   customId     = the stable lookup key (e.g. "daily-schedule:2026-06-10")
  //   content      = the fact text or JSON-encoded schedule
  //   metadata     = filterable bag: { kind, source, ... }
  // ---------------------------------------------------------------------------

  async add(input: FactInput): Promise<{ id: string }> {
    const response = await this.db.documents.add({
      content: input.content,
      containerTag: this.space.name,
      customId: input.customId,
      metadata: input.metadata,
    });
    return { id: response.id };
  }

  async get(
    customId: string,
  ): Promise<{ content: string; metadata: FactMetadata | null } | null> {
    const listed = await this.db.documents.list({
      containerTags: [this.space.name],
      limit: 200,
    });
    const match = (listed.memories ?? []).find((m) => m.customId === customId);
    if (!match) return null;
    const full = await this.db.documents.get(match.id);
    return {
      content: full.content ?? "",
      metadata: (full.metadata ?? null) as FactMetadata | null,
    };
  }

  async list(): Promise<Array<{ customId: string | null; content: string }>> {
    const listed = await this.db.documents.list({
      containerTags: [this.space.name],
      limit: 200,
    });
    return (listed.memories ?? []).map((d) => ({
      customId: d.customId,
      content: d.content ?? "",
    }));
  }

  async search(query: string, limit = 5): Promise<SearchHit[]> {
    const response = await this.db.search.execute({
      q: query,
      containerTag: this.space.name,
      limit,
      onlyMatchingChunks: true,
    });
    return (response.results ?? []).map((r) => {
      const firstChunk = r.chunks?.[0];
      return {
        content: firstChunk?.content ?? "",
        score: r.score,
      };
    });
  }
}
